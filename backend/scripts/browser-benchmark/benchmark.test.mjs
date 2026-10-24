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
  const jobs = schedule(
    variants,
    cases.filter((c) => !c.attachment),
    ['fresh', 'established'],
    3,
  );
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

test('billing refreshes a stale credential list and tolerates an already absent cleanup item', async (t) => {
  let synced = false,
    deletes = 0,
    syncs = 0;
  let lookups = 0,
    removedRoute = false;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (_url.endsWith('/sync')) {
      synced = true;
      syncs++;
      return Response.json({ success: true, data: {} });
    }
    if (options.method === 'DELETE') {
      deletes++;
      return new Response(null, { status: 404 });
    }
    const data =
      options.method === 'POST'
        ? { id: 'fixture-id' }
        : { data: (++lookups, synced) ? [{ id: 'fixture-id' }] : [] };
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
  assert.equal(deletes, 2);
  assert.equal(syncs, 2);
});

test('partitioned variant/round jobs preserve all 324 unique matrix keys', () => {
  const expected = schedule(
    variants,
    cases.filter((c) => !c.attachment),
    ['fresh', 'established'],
    3,
  );
  const partitioned = [0, 1, 2].flatMap((round) =>
    variants.flatMap((variant) =>
      schedule(
        [variant],
        cases.filter((c) => !c.attachment),
        ['fresh', 'established'],
        1,
        round,
      ),
    ),
  );
  assert.equal(partitioned.length, 324);
  assert.deepEqual(
    new Set(partitioned.map((x) => x.key)),
    new Set(expected.map((x) => x.key)),
  );
});

test('billing retries an explicit hosted rate limit wrapped in HTTP 400', async (t) => {
  let creates = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (options.method === 'POST' && ++creates === 1)
      return Response.json(
        {
          success: false,
          message: 'CreateCipherError: status code 429 Too Many Requests',
        },
        { status: 400 },
      );
    return Response.json({
      success: true,
      data:
        options.method === 'POST'
          ? { id: 'owned-id' }
          : { data: [{ id: 'owned-id' }] },
    });
  });
  const context = { route: async () => {}, unroute: async () => {} };
  const fixture = await installFixture(
    { connect: async () => ({ contexts: () => [context] }) },
    { id: 'billing', path: '/login' },
    'rate-limit',
  );
  assert.equal(creates, 2);
  assert.equal(fixture.state.vaultRateLimitRetries, 1);
  await fixture.close();
});

// Tool availability is an enforced experimental boundary, independent of prompts.
test('delegation arms retain only their declared Task capabilities', async () => {
  const { taskToolAllowed, delegationVariants, delegationGuidance } =
    await import('./delegation.mjs');
  assert.equal(delegationVariants.length, 5);
  const both = delegationVariants.find((v) => v.id === 'luna-coordinator-both');
  assert.equal(both.boundary, 'coordinator');
  assert.equal(both.model, 'gpt-6-luna');
  assert.equal(both.effort, 'high');
  assert.equal(both.generalModel, 'gpt-6-luna');
  assert.equal(both.generalEffort, 'high');
  assert.match(delegationGuidance(both), /agent-general \(Luna high\)/);
  assert.match(
    delegationGuidance(delegationVariants[0]),
    /agent-general \(Sol medium\)/,
  );
  for (const { boundary } of delegationVariants.filter(
    (v) => v.boundary !== 'interaction-mcp',
  )) {
    for (const name of [
      'browser',
      'login_inspect',
      'secure_fill',
      'mastra_workspace_computer_click',
      'skill',
    ])
      assert.equal(taskToolAllowed(boundary, name), false);
    assert.equal(taskToolAllowed(boundary, 'agent-general'), true);
    assert.equal(taskToolAllowed(boundary, 'set_task_status'), true);
  }
  assert.equal(
    taskToolAllowed('coordinator', 'mastra_workspace_read_file'),
    false,
  );
  assert.equal(taskToolAllowed('services', 'mastra_workspace_read_file'), true);
  assert.equal(
    taskToolAllowed('services', 'mastra_workspace_execute_command'),
    false,
  );
  assert.equal(
    taskToolAllowed('execution', 'mastra_workspace_execute_command'),
    true,
  );
  const briefCase = cases.find((c) => c.id === 'support-file');
  assert.equal(score(briefCase, initialState(), 'High').success, false);
  assert.ok(
    !history('established', briefCase).some((m) => m.content.includes('E42')),
  );
});

test('general-worker requests contribute to usage and missing-usage status', () => {
  const report = summarize(
    [{ sample: 'general', generalModel: 'gpt-6.1-sol' }],
    [
      { sample: 'general', event: 'model.start', role: 'general' },
      {
        sample: 'general',
        event: 'model.finish',
        role: 'general',
        inputTokens: 100,
        cachedTokens: 50,
        outputTokens: 10,
        reasoningTokens: 2,
        ms: 1000,
      },
    ],
  );
  assert.equal(report.samples[0].inputTokens, 100);
  assert.equal(report.samples[0].outputTokens, 10);
  assert.equal(report.samples[0].usageComplete, true);
  const incomplete = summarize(
    [{ sample: 'general', generalModel: 'gpt-6.1-sol' }],
    [{ sample: 'general', event: 'model.start', role: 'general' }],
  );
  assert.equal(incomplete.samples[0].usageComplete, false);
});

test('result boundary validation works after generation and rejects forbidden tools', async () => {
  const { validBoundaries } = await import('./delegation.mjs');
  const variant = { delegated: true, boundary: 'services' };
  const worker = { role: 'worker', tools: ['browser'] };
  assert.equal(
    validBoundaries(variant, [
      { role: 'task', tools: ['mastra_workspace_read_file'] },
      worker,
    ]),
    true,
  );
  assert.equal(
    validBoundaries(variant, [
      { role: 'task', tools: ['mastra_workspace_execute_command'] },
      worker,
    ]),
    false,
  );
  assert.equal(
    validBoundaries(variant, [{ role: 'general', tools: ['browser'] }, worker]),
    false,
  );
  assert.equal(validBoundaries(variant, [{ role: 'task', tools: [] }]), false);
});

// The two-role arm keeps local execution on Task and service/UI access on interaction.
test('interaction-MCP arm exposes no general worker or worker file/shell tools', async () => {
  const {
    delegationVariants,
    delegationGuidance,
    taskToolAllowed,
    validBoundaries,
  } = await import('./delegation.mjs');
  const variant = delegationVariants.find(
    (v) => v.id === 'luna-interaction-mcp',
  );
  assert.equal(variant.model, 'gpt-6-luna');
  assert.equal(variant.effort, 'high');
  assert.match(delegationGuidance(variant), /There is no general worker/);
  const task = {
    role: 'task',
    tools: [
      'agent-worker',
      'mastra_workspace_read_file',
      'mastra_workspace_execute_command',
      'web_search',
      'execute_typescript',
    ],
  };
  const worker = {
    role: 'worker',
    tools: [
      'browser',
      'secure_fill',
      'mastra_workspace_computer_click',
      'search_tools',
      'execute_typescript',
    ],
  };
  assert.equal(validBoundaries(variant, [task, worker]), true);
  const service = 'example_lookup';
  assert.equal(
    validBoundaries(
      variant,
      [task, { ...worker, tools: [...worker.tools, service] }],
      [service],
    ),
    true,
  );
  assert.equal(
    validBoundaries(
      variant,
      [{ ...task, tools: [...task.tools, service] }, worker],
      [service],
    ),
    false,
  );
  assert.equal(
    validBoundaries(
      variant,
      [task, { ...worker, tools: [...worker.tools, 'unknown_tool'] }],
      [service],
    ),
    false,
  );
  assert.equal(validBoundaries(variant, [worker]), false);
  assert.equal(validBoundaries(variant, [task]), false);
  assert.equal(
    validBoundaries(variant, [task, worker, { role: 'general', tools: [] }]),
    false,
  );
  for (const name of [
    'mastra_workspace_read_file',
    'mastra_workspace_execute_command',
    'web_search',
    'agent-worker',
    'read_preferences',
  ]) {
    assert.equal(
      validBoundaries(variant, [
        task,
        { ...worker, tools: [...worker.tools, name] },
      ]),
      false,
    );
  }
  for (const name of [
    'search_tools',
    'agent-general',
    'browser',
    'mastra_workspace_computer_click',
  ]) {
    assert.equal(taskToolAllowed(variant.boundary, name), false);
  }
});
