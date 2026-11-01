import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arms,
  comparisonSchedule,
  comparisonCases,
  comparisonState,
  comparisonTransition,
  comparisonSecrets,
  comparisonScore,
  exposesComparisonSecret,
} from './comparison-cases.mjs';
test('main rotates all 36 cells; human-assisted work is a separate final run', () => {
  const jobs = comparisonSchedule({});
  assert.equal(jobs.length, 36);
  assert.equal(new Set(jobs.map((j) => j.key)).size, 36);
  for (let round = 0; round < 3; round++)
    assert.equal(jobs.find((j) => j.round === round).arm, arms[round]);
  assert(jobs.every((j) => !j.scenario.assisted));
  assert.equal(comparisonSchedule({ phase: 'assisted' }).length, 6);
  assert.throws(() => comparisonSchedule({ cases: ['apple-store'] }));
  assert.throws(() =>
    comparisonSchedule({ phase: 'assisted', cases: ['staged-login'] }),
  );
});
test('fixture success requires exact private values, actual fills and one authenticated draft', () => {
  const state = comparisonState(),
    scenario = comparisonCases[0];
  comparisonTransition(state, 'next', { username: 'wrong' });
  assert.equal(state.stage, 0);
  for (const role of ['username', 'password', 'code'])
    comparisonTransition(state, 'next', { [role]: comparisonSecrets[role] });
  comparisonTransition(state, 'draft', { reference: 'PAL-DRAFT-42' });
  const sample = {
    scenario,
    state,
    fillRoles: ['username', 'password', 'code'],
    boundaryValid: true,
    privacyValid: true,
    status: 'completed',
  };
  assert.equal(comparisonScore(sample).success, true);
  assert.equal(comparisonScore({ ...sample, fillRoles: [] }).success, false);
  assert.equal(
    comparisonScore({ ...sample, boundaryValid: false }).success,
    false,
  );
  comparisonTransition(state, 'draft', { reference: 'PAL-DRAFT-42' });
  assert.equal(comparisonScore(sample).success, false);
  assert(exposesComparisonSecret({ label: comparisonSecrets.password }));
});
test('live keyword answers cannot establish success or replace real private filling', () => {
  const sample = {
    scenario: comparisonCases[1],
    boundaryValid: true,
    privacyValid: true,
    status: 'completed',
    answer: 'Delivered',
  };
  assert.equal(comparisonScore({ ...sample, fillRoles: [] }).success, false);
  assert.equal(
    comparisonScore({ ...sample, fillRoles: ['username'] }).success,
    null,
  );
});

import {
  validComparisonInventory,
  assistedQueue,
} from './comparison-tools.mjs';
test('method inventories exclude bypasses and human dependencies queue after main', () => {
  assert(
    validComparisonInventory('computer', 'worker', [
      'login_inspect',
      'secure_fill',
      'skill',
      'mastra_workspace_computer_screenshot',
    ]),
  );
  for (const tool of [
    'browser',
    'android_type',
    'execute_typescript',
    'mastra_workspace_read_file',
    'web_search',
  ])
    assert(!validComparisonInventory('computer', 'worker', [tool]));
  assert(!validComparisonInventory('browser', 'task', ['browser']));
  assert(!validComparisonInventory('android', 'worker', ['browser']));
  assert.deepEqual(
    assistedQueue([
      {
        needsHuman: true,
        key: 'x',
        reason: 'verification-code',
        variant: 'android',
      },
    ])[0].timing,
    'after-main-run',
  );
});

test('the final assisted manifest imports deferred methods and preserves source samples', () => {
  const jobs = comparisonSchedule({
    phase: 'assisted',
    assistedJobs: [
      {
        key: 'assisted:main:0:amazon-order:android',
        case: 'amazon-order',
        arm: 'android',
        round: 0,
        sourceSample: 'old',
      },
    ],
  });
  assert.equal(jobs[0].sourceSample, 'old');
  assert.equal(jobs[0].arm, 'android');
  assert.throws(() => comparisonSchedule({ phase: 'main', assistedJobs: [] }));
  assert.throws(() =>
    comparisonSchedule({
      phase: 'assisted',
      assistedJobs: [{ key: 'a', case: 'apple-store', arm: 'android' }],
    }),
  );
});

test('a duplicated credential write cannot pass the staged comparison', () => {
  const state = { authenticated: true, draft: 'PAL-DRAFT-42', saves: 1 };
  assert.equal(
    comparisonScore({
      scenario: comparisonCases[0],
      state,
      fillRoles: ['username', 'username', 'password', 'code'],
      boundaryValid: true,
      privacyValid: true,
      status: 'completed',
    }).success,
    false,
  );
});

test('native fixture reset accepts Android uppercase buttons and verifies the next starting state', async () => {
  const { prepareNativeFixture } = await import('./comparison-native.mjs');
  const fresh = {
    status: 'ready',
    identity: { packageName: 'dev.pal.securefixture' },
    elements: [{ text: 'Pal secure fixture — Username' }],
    inputs: [{ label: 'Email or username' }],
  };
  const saved = {
    ...fresh,
    elements: [{ text: 'START AGAIN', ref: '@reset' }],
    inputs: [],
  };
  let view = saved,
    taps = 0;
  const android = {
    secure: async () => view,
    call: async (_, action, args) => {
      if (action === 'android_tap') {
        assert.equal(args.ref, '@reset');
        taps++;
        view = fresh;
      }
    },
  };
  await prepareNativeFixture(android, {});
  await prepareNativeFixture(android, {});
  assert.equal(taps, 1);
  view = saved;
  android.call = async () => {};
  await assert.rejects(
    prepareNativeFixture(android, {}),
    /fresh username stage/,
  );
});
