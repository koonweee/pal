import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LoginBrowser } from '../dist/login/login-browser.js';

const output = resolve('../.local/login-acceptance');
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({
  channel: 'chrome',
  executablePath: process.env.TEST_CHROMIUM_PATH,
  headless: true,
});
const results = [];
try {
  for (const [name, url] of [
    ['apple', 'https://account.apple.com/sign-in'],
    ['amazon', 'https://www.amazon.com/gp/sign-in.html'],
  ]) {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2000);
      const result = await new LoginBrowser().inspect(
        page,
        'acceptance:' + name,
      );
      await writeFile(resolve(output, name + '.png'), result.image, {
        mode: 0o600,
      });
      results.push({
        name,
        origin: new URL(page.url()).origin,
        targets: result.targets.map(({ origin, fields }) => ({
          origin,
          fields,
        })),
        status: result.targets.length ? 'inspected' : 'no_supported_fields',
      });
    } catch {
      results.push({ name, status: 'unavailable_or_interactive' });
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(
  resolve(output, 'report.json'),
  JSON.stringify(results, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(results));
