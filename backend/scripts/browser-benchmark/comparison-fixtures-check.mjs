// Exercise the shared route handler; no model calls or personal browser profile.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { productEvidence } from './comparison-evidence.mjs';
import { installFixture } from './fixtures.mjs';
import {
  comparisonCases,
  comparisonSecrets,
  comparisonScore,
} from './comparison-cases.mjs';
const { chromium } = createRequire(import.meta.url)(
  '../../node_modules/playwright-core',
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await browser.newContext();
  const fixture = await installFixture(
    { connect: async () => browser },
    comparisonCases[0],
    'comparison-check',
  );
  try {
    const page = await browser.contexts()[0].newPage();
    await page.goto(fixture.url);
    for (const [role, label] of [
      ['username', 'Email or username'],
      ['password', 'Password'],
      ['code', 'Verification code'],
    ]) {
      await page
        .getByLabel(label, { exact: true })
        .fill(comparisonSecrets[role]);
      await page
        .getByRole('button', {
          name: role === 'code' ? 'Verify' : 'Continue',
          exact: true,
        })
        .click();
    }
    await page.getByLabel('Draft reference').fill('PAL-DRAFT-42');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page
      .getByRole('status')
      .filter({ hasText: 'Draft saved: PAL-DRAFT-42' })
      .waitFor();
    assert.equal(
      comparisonScore({
        scenario: comparisonCases[0],
        state: fixture.state,
        fillRoles: ['username', 'password', 'code'],
        boundaryValid: true,
        privacyValid: true,
        status: 'completed',
      }).success,
      true,
    );
    console.log(
      'PASS: shared comparison route, staged Unicode fill and authenticated single draft',
    );
    await page.reload();
    await page
      .getByRole('status')
      .filter({ hasText: 'Draft saved: PAL-DRAFT-42; saves: 1' })
      .waitFor();
    const evidencePage = await browser.contexts()[0].newPage();
    await evidencePage.setContent(
      '<span>PRIVATE_ACCOUNT_CANARY</span><h1 id="productTitle">Sony WH-1000XM5 Black</h1><div id="corePrice_feature_div"><span class="a-offscreen">$299.99</span></div><div id="availability">In Stock</div>',
    );
    const facts = await evidencePage.evaluate(productEvidence);
    assert.equal(facts[0].availability, 'In Stock');
    assert.equal(facts[0].price, '$299.99');
    assert(!JSON.stringify(facts).includes('PRIVATE_ACCOUNT_CANARY'));
    await evidencePage.close();
  } finally {
    await fixture.close();
  }
} finally {
  await browser.close();
}
