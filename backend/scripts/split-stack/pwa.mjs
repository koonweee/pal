import assert from 'node:assert/strict';
import { FIRST_PARTY_CONTRACT_VERSION } from '../../../frontend/src/api/contract.ts';
import { chromium } from '../../../frontend/node_modules/@playwright/test/index.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto('http://127.0.0.1:14080', { waitUntil: 'domcontentloaded' });
  await page
    .getByText('Split runtime verified', { exact: true })
    .first()
    .waitFor();
  const streamEvent = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const source = new EventSource('/api/stream');
        const timer = setTimeout(() => {
          source.close();
          reject(new Error('SSE timed out'));
        }, 5000);
        source.addEventListener('frontend.updated', (event) => {
          clearTimeout(timer);
          source.close();
          resolve(JSON.parse(event.data));
        });
      }),
  );
  assert.equal(streamEvent.contractVersion, FIRST_PARTY_CONTRACT_VERSION);
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('link', { name: /^Download report.txt,/ })
    .first()
    .click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), 'report.txt');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(
    Buffer.concat(chunks).toString(),
    'Immutable split-stack result',
  );
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/files') &&
      response.request().method() === 'POST',
  );
  await page.locator('#file-input').setInputFiles({
    name: 'pwa-input.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('PWA split-stack upload'),
  });
  assert.equal((await uploaded).status(), 201);
  await page.locator('#pending-files [data-state="ready"]').waitFor();
  const desktop = await page.request.get(
    'http://127.0.0.1:14080/desktop/v2/vnc.html',
  );
  assert.equal(desktop.status(), 200);
  assert.match(await desktop.text(), /noVNC/);
  const banner = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(
          'ws://127.0.0.1:14080/desktop/v2/websockify',
        );
        socket.binaryType = 'arraybuffer';
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error('noVNC WebSocket timed out'));
        }, 5000);
        socket.onerror = () => {
          clearTimeout(timer);
          reject(new Error('noVNC WebSocket failed'));
        };
        socket.onmessage = (event) => {
          clearTimeout(timer);
          const text = new TextDecoder().decode(event.data);
          socket.close();
          resolve(text);
        };
      }),
  );
  assert.match(banner, /^RFB /);
  console.log(
    'PASS: real PWA history/SSE, immutable file download, upload UI, and desktop viewer HTTP/WebSocket routing',
  );
} finally {
  await browser.close();
}
