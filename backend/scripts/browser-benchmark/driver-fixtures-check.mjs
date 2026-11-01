// Independent browser oracle: no model calls, private vault, or shared desktop.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  driverCases,
  driverPage,
  driverState,
  driverTransition,
  driverSecrets,
} from './driver-cases.mjs';
const { chromium } = createRequire(import.meta.url)(
  '../../node_modules/playwright-core',
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const scenario of driverCases.filter((c) => !c.resume)) {
    const context = await browser.newContext(),
      state = driverState(),
      origin = 'https://fixture.example.test';
    await context.route(
      (url) => url.hostname.endsWith('fixture.example.test'),
      async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/action') {
          const { action, values, lane } = route.request().postDataJSON();
          return route.fulfill({
            json: driverTransition(state, action, values, lane),
          });
        }
        state.pages.push(url.pathname);
        return route.fulfill({
          contentType: 'text/html',
          body: driverPage(url.pathname, state, origin),
        });
      },
    );
    const tab = await context.newPage();
    await tab.goto(origin + scenario.path);
    const fill = async (name, value) =>
      tab.getByLabel(name, { exact: true }).fill(value);
    if (scenario.id === 'driver-auth') {
      await fill('Phone number', driverSecrets.username);
      await tab.getByRole('button', { name: 'Continue' }).click();
      await fill('PIN', driverSecrets.password);
      await tab.getByRole('button', { name: 'Continue' }).click();
      for (let i = 0; i < 6; i++)
        await fill('Digit ' + (i + 1), driverSecrets.code[i]);
      await tab.getByRole('button', { name: 'Verify' }).click();
      await tab.getByRole('heading', { name: 'Signed in' }).waitFor();
      assert.equal(state.authenticated, true);
    } else if (scenario.id === 'driver-payment') {
      await fill('Cardholder', 'Synthetic Customer');
      await tab
        .frameLocator('iframe[title="Card number"]')
        .getByLabel('Card number')
        .fill(driverSecrets.number);
      await tab
        .frameLocator('iframe[title="Security code"]')
        .getByLabel('Security code')
        .fill(driverSecrets.securityCode);
      for (const [label, value] of [
        ['Expiry month', '12'],
        ['Expiry year', '2029'],
        ['Billing city', 'Portland'],
        ['Postal code', '97205'],
      ])
        await fill(label, value);
      await tab.getByRole('button', { name: 'Pay USD 12.34' }).click();
      await tab.getByRole('heading', { name: 'Saved receipt' }).waitFor();
      assert.equal(state.paymentValid, true);
    } else if (scenario.id === 'driver-form') {
      await fill('Subject', 'E42');
      await tab.getByLabel('Workspace').selectOption('Acme Studio');
      await tab.getByLabel('Priority').selectOption('High');
      await tab
        .getByLabel('Diagnostic attachment')
        .setInputFiles({
          name: 'diagnostic.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Diagnostic E42: export failed.'),
        });
      await tab.getByRole('button', { name: 'Review' }).click();
      assert.equal(state.submissions, 0);
      await tab.getByRole('button', { name: 'Confirm submission' }).click();
      await tab.getByText('Saved and submitted once').waitFor();
      assert.equal(
        state.saves[0].attachment.text,
        'Diagnostic E42: export failed.',
      );
    } else if (scenario.id === 'driver-handoff') {
      await fill('Document reference', 'DOC-739');
      await fill('Document amount', '83.27');
      await tab.getByRole('button', { name: 'Save', exact: true }).click();
      await tab.getByText('Saved and submitted once').waitFor();
    } else if (scenario.id === 'driver-recovery') {
      await tab.getByRole('link', { name: 'Continue to entry' }).click();
      await fill('Reference', 'ACME-42');
      await tab.getByRole('button', { name: 'Save once' }).click();
      await tab.getByRole('heading', { name: 'Saved receipt' }).waitFor();
    } else {
      for (const lane of ['alpha', 'beta']) {
        await tab.goto(origin + '/parallel?lane=' + lane);
        await fill('Reference', lane.toUpperCase());
        await tab.getByRole('button', { name: 'Save lane' }).click();
        await tab.getByText('Saved and submitted once').waitFor();
      }
    }
    if (scenario.id !== 'driver-auth')
      assert.equal(state.submissions, scenario.concurrent ? 2 : 1);
    console.log('PASS fixture UI:', scenario.id);
    await context.close();
  }
} finally {
  await browser.close();
}
