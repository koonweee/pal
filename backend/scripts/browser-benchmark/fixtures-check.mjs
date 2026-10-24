// Deterministic fixture validation; no model calls or shared desktop access.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initialState, transition, page } from './fixtures.mjs';
import { cases, score } from './cases.mjs';
const { chromium } = createRequire(import.meta.url)(
  '../../node_modules/playwright-core',
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const scenario of cases.filter((c) => c.kind === 'synthetic')) {
    const context = await browser.newContext();
    const state = initialState();
    await context.route('https://fixture.example.test/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname === '/action') {
        const { action, values } = request.postDataJSON();
        return route.fulfill({ json: transition(state, action, values) });
      }
      state.pages.push(url.pathname);
      return route.fulfill({
        contentType: 'text/html',
        body: page(url.pathname, state),
      });
    });
    const tab = await context.newPage();
    await tab.goto('https://fixture.example.test' + scenario.path);
    if (scenario.id === 'billing') {
      await tab.getByLabel('Email address').fill('benchmark@example.invalid');
      await tab.getByRole('button', { name: 'Continue', exact: true }).click();
      await tab
        .getByLabel('Password', { exact: true })
        .fill('Browser-benchmark-dummy-only!');
      await tab.getByRole('button', { name: 'Sign in', exact: true }).click();
      await tab.getByRole('link', { name: 'September 2026' }).click();
      await tab
        .getByRole('heading', { name: 'Invoice INV-2609-104' })
        .waitFor();
    } else if (scenario.id === 'stays') {
      await tab.getByRole('link', { name: 'Cedar House', exact: true }).click();
      await tab.getByRole('heading', { name: 'Cedar House' }).waitFor();
    } else if (scenario.id === 'support') {
      await tab.getByLabel('Workspace').selectOption('Acme Studio');
      await tab.getByLabel('Subject').fill('CSV export error E42');
      await tab.getByLabel('Priority').selectOption('High');
      await tab
        .getByLabel('Description')
        .fill(
          'E42 in Chrome and Firefox since October 21. All 12 teammates affected. Clearing cache and retry did not help. Blocks month-end reporting.',
        );
      await tab
        .getByRole('button', { name: 'Save draft', exact: true })
        .click();
      await tab
        .getByRole('status')
        .filter({ hasText: 'Draft saved' })
        .waitFor();
    } else {
      for (const [label, value] of [
        ['Merchant', 'Northstar Cafe'],
        ['Date (YYYY-MM-DD)', '2026-10-20'],
        ['Amount (USD)', '38.60'],
        ['Project', 'Acme Launch'],
      ])
        await tab.getByLabel(label, { exact: true }).fill(value);
      await tab.getByLabel('Category').selectOption('Meals');
      await tab
        .getByRole('button', { name: 'Save draft', exact: true })
        .click();
      await tab
        .getByRole('status')
        .filter({ hasText: 'Expense draft saved' })
        .waitFor();
    }
    assert.equal(
      score(
        scenario,
        state,
        scenario.expected.join(' '),
        scenario.computer ? ['mastra_workspace_computer_click'] : [],
      ).success,
      true,
      scenario.id,
    );
    console.log('PASS fixture UI:', scenario.id);
    await context.close();
  }
} finally {
  await browser.close();
}
