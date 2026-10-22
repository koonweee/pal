import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', {
  noDefaults: true,
});
try {
  const page = await browser.contexts()[0].newPage();
  await page.goto('http://127.0.0.1:8765/');
  if (process.env.MIGRATION_PHASE === 'seed') {
    await page.locator('[name=username]').fill('fixture-user');
    await page.locator('[name=password]').fill('fixture-password');
    await page.locator('button').click();
    await page.goto('http://127.0.0.1:8765/');
  }
  assert.match(await page.locator('h1').innerText(), /Existing login retained/);
  console.log('PASS: persistent Chromium login session');
  await browser.close(); // Disconnect does not terminate the persistent browser.
} finally {
  if (browser.isConnected()) await browser.close();
}
