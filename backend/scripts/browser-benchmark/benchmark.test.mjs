import test from 'node:test';
import assert from 'node:assert/strict';
import { variants, cases, schedule, score, history } from './cases.mjs';
import { initialState, transition, installFixture } from './fixtures.mjs';
import { summarize } from './report.mjs';

test('matrix contains exact settings with paired contexts and counterbalanced repetitions', () => {
  assert.equal(variants.length, 9);
  assert.deepEqual(
    variants.map((v) => v.id),
    [
      'control',
      'sol-low',
      'sol-medium',
      'sol-high',
      'luna-low',
      'luna-high',
      'luna-xhigh',
      'astra-low',
      'astra-medium',
    ],
  );
  const jobs = schedule(variants, cases, ['fresh', 'established'], 3);
  assert.equal(jobs.length, 324);
  assert.equal(new Set(jobs.map((j) => j.key)).size, 324);
  assert.ok(
    history('established', cases[0]).length > history('fresh', cases[0]).length,
  );
});
test('billing requires authentication and observed invoice, not merely correct answer keywords', () => {
  const scenario = cases[0],
    state = initialState(),
    answer = scenario.expected.join(' ');
  assert.equal(score(scenario, state, answer).success, false);
  transition(state, 'username', { username: 'benchmark@example.invalid' });
  transition(state, 'password', { password: 'wrong' });
  assert.equal(state.signedIn, false);
  transition(state, 'password', { password: 'Browser-benchmark-dummy-only!' });
  state.pages.push('/invoices/INV-2609-104');
  assert.equal(score(scenario, state, answer).success, true);
  transition(state, 'submit', {});
  assert.equal(score(scenario, state, answer).success, false);
});
test('saved support draft must preserve all constraints and avoid submission', () => {
  const scenario = cases.find((c) => c.id === 'support'),
    state = initialState();
  state.pages.push('/support');
  transition(state, 'draft', {
    title: 'CSV export error',
    priority: 'High',
    workspace: 'Acme Studio',
    description:
      'E42 Chrome Firefox 12 teammates since October 21. Clearing cache and retry failed; blocks month-end reporting.',
  });
  assert.equal(score(scenario, state, 'High').success, true);
  state.draft.description = 'CSV broken';
  assert.equal(score(scenario, state, 'High').success, false);
});
test('live keyword checks remain pending review; report retains failures and incomplete token usage', () => {
  const live = cases.find((c) => c.id === 'live-mdn'),
    state = initialState();
  state.pages.push(live.url);
  assert.equal(
    score(live, state, 'no-cache no-store ' + live.url).success,
    null,
  );
  const rows = [
    {
      sample: 'a',
      case: 'billing',
      context: 'fresh',
      variant: 'control',
      status: 'timeout',
      success: false,
      elapsedMs: 60000,
    },
    {
      sample: 'b',
      case: 'billing',
      context: 'fresh',
      variant: 'control',
      status: 'completed',
      success: true,
      elapsedMs: 10000,
    },
  ];
  const report = summarize(rows, [
    { sample: 'a', event: 'model.start', role: 'task' },
  ]);
  assert.equal(report.groups[0].medianMs, 35000);
  assert.equal(report.groups[0].successfulMedianMs, 10000);
  assert.equal(report.samples[0].usageComplete, false);
  assert.equal(report.samples[0].inputTokens, null);
});

test('partial provider usage stays unknown rather than undercounting retries', () => {
  const report = summarize(
    [
      {
        sample: 'a',
        case: 'billing',
        context: 'fresh',
        variant: 'control',
        status: 'error',
        success: false,
      },
    ],
    [
      { sample: 'a', event: 'model.start', role: 'task' },
      { sample: 'a', event: 'model.start', role: 'task' },
      {
        sample: 'a',
        event: 'model.finish',
        role: 'task',
        inputTokens: 100,
        outputTokens: 20,
        cachedTokens: 50,
        reasoningTokens: 5,
        ms: 1000,
      },
    ],
  );
  assert.equal(report.samples[0].inputTokens, null);
  assert.equal(report.samples[0].roleUsage.task.observedUsage.inputTokens, 100);
  assert.equal(report.groups[0].minMs, null);
});

test('scoring accepts equivalent wording and rejects numeric/status substrings', () => {
  const billing = cases.find((c) => c.id === 'billing');
  const state = {
    ...initialState(),
    signedIn: true,
    pages: ['/invoices/INV-2609-104'],
  };
  assert.equal(
    score(billing, state, 'INV-2609-104 USD 248.4 due 2026-10-15 Paid').success,
    true,
  );
  assert.equal(
    score(billing, state, 'INV-2609-104 USD 1248.40 due 2026-10-15 Unpaid')
      .success,
    false,
  );
  const support = cases.find((c) => c.id === 'support');
  state.pages = ['/support'];
  state.draft = {
    workspace: 'Acme Studio',
    priority: 'High',
    title: 'CSV exports fail',
    description:
      'E42 in Chrome and Firefox since October 21. All twelve teammates affected, blocking month-end reporting. Cleared the cache and retried.',
  };
  assert.equal(score(support, state, 'High').success, true);
});

test('billing waits for credential lookup and tolerates an already absent cleanup item', async (t) => {
  let lookups = 0,
    removedRoute = false;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (options.method === 'DELETE') return new Response(null, { status: 404 });
    const data =
      options.method === 'POST'
        ? { id: 'fixture-id' }
        : { data: ++lookups === 1 ? [] : [{ id: 'fixture-id' }] };
    return Response.json({ success: true, data });
  });
  const context = {
    route: async () => {},
    unroute: async () => {
      removedRoute = true;
    },
  };
  const browser = { connect: async () => ({ contexts: () => [context] }) };
  const fixture = await installFixture(
    browser,
    { id: 'billing', path: '/login' },
    'test',
  );
  assert.equal(lookups, 2);
  await fixture.close();
  assert.equal(removedRoute, true);
});
