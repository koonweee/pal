import { createServer, request as proxyRequest } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { startKeyboard } from './keyboard.mjs';
import { attachViewer } from './viewer.mjs';
import { HelperClient } from './helper-client.mjs';

const token = process.env.MOBILEMCP_AUTH;
if (!token) throw new Error('Android sidecar token is required');
let closing = false;
const mcp = spawn('/opt/android/node_modules/.bin/mcp-server-mobile', ['--listen', '127.0.0.1:3002'], { stdio: 'inherit' });
mcp.once('error', () => process.exit(1));
mcp.once('exit', () => { if (!closing) process.exit(1); });
const helper = new HelperClient(process.env.PAL_ANDROID_DEVICE_ID);
let pending = Promise.resolve();
const allowed = new Set(['inspect', 'validate', 'fill', 'pause']);
const server = createServer(async (request, response) => {
  const actual = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from('Bearer ' + token);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    response.writeHead(401).end(); return;
  }
  if (request.url === '/secure' && request.method === 'POST') {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 65536) { response.writeHead(413).end(); return; }
      }
      const input = JSON.parse(body); body = '';
      if (input.device !== process.env.PAL_ANDROID_DEVICE_ID || !allowed.has(input.action)) { response.writeHead(400).end(); return; }
      const operation = pending.then(async () => {
        if (input.action === 'pause') { await helper.stop(); return { status: 'stopped' }; }
        // Read-only capture may race an animation or accessibility event.
        // A fill is dispatched once and is never replayed here.
        const reads = input.action === 'inspect' ? 3 : 1;
        let result;
        try {
          for (let attempt = 0; attempt < reads; attempt++) {
            result = await helper.call(input);
            if (result.status !== 'error' || attempt + 1 === reads) return result;
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        } finally {
          for (const field of input.fields ?? []) delete field.value;
        }
      });
      pending = operation.then(() => {}, () => {});
      response.end(JSON.stringify(await operation));
    } catch {
      // Never serialize exceptions, native requests, headers, or submitted values.
      response.writeHead(503).end(JSON.stringify({ status: 'error', code: 'helper_unavailable_or_uncertain' }));
    }
    return;
  }
  if (request.url !== '/mcp') { response.writeHead(404).end(); return; }
  const upstream = proxyRequest({ host: '127.0.0.1', port: 3002, path: '/mcp', method: request.method, headers: { ...request.headers, host: '127.0.0.1:3002' } }, (incoming) => {
    response.writeHead(incoming.statusCode ?? 502, incoming.headers);
    incoming.pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(503); response.end(); });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
});
const stopKeyboard = startKeyboard();
const stopViewer = attachViewer(server, token);
server.listen(3000, '0.0.0.0');
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  await stopViewer();
  await stopKeyboard();
  await pending;
  await helper.close().catch(() => {});
  mcp.kill('SIGTERM');
  process.exit(0);
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
