import test from 'node:test';
import assert from 'node:assert/strict';
import {
  driverCases,
  driverSecrets,
  driverState,
  driverTransition,
  scoreDriver,
} from './driver-cases.mjs';
import { allVariants, schedule } from './cases.mjs';
import { exposesDriverSecret, recordRecoveryStep } from './driver-cases.mjs';

test('lost acknowledgement is injected on the committed action and verified by a later observation', () => {
  const state = driverState();
  assert.equal(
    recordRecoveryStep(state, { action: true, observation: false }),
    false,
  );
  state.submissions = 1;
  assert.equal(
    recordRecoveryStep(state, {
      action: false,
      observation: true,
      url: 'https://fixture/receipt',
    }),
    false,
  );
  assert.equal(state.injectedTimeout, undefined);
  assert.equal(
    recordRecoveryStep(state, { action: true, observation: false }),
    true,
  );
  assert.equal(state.recoveryObserved, undefined);
  assert.equal(
    recordRecoveryStep(state, {
      action: false,
      observation: true,
      url: 'https://fixture/receipt',
    }),
    false,
  );
  assert.equal(state.recoveryObserved, true);
  assert.equal(
    recordRecoveryStep(state, { action: true, observation: false }),
    false,
  );
});

test('text-secret grading excludes encoded image bytes and detects actual field values', () => {
  assert.equal(
    exposesDriverSecret({ image: 'a'.repeat(1100) + '/658/' }),
    false,
  );
  assert.equal(
    exposesDriverSecret({ inputs: [{ value: driverSecrets.password }] }),
    true,
  );
  assert.equal(
    exposesDriverSecret({ text: 'Card number: ' + driverSecrets.number }),
    true,
  );
  assert.equal(exposesDriverSecret({ ref: 'prefix658suffix' }), false);
});

test('driver matrix fixes worker settings and counterbalances 48 unique runs', () => {
  const variants = allVariants.filter((v) => v.driver);
  assert.deepEqual(
    variants.map((v) => [v.model, v.effort]),
    [
      ['gpt-6.1-terra', 'medium'],
      ['gpt-6.1-terra', 'medium'],
    ],
  );
  const jobs = schedule(
    variants,
    [{ id: 'stays' }, ...driverCases],
    ['fresh'],
    3,
  );
  assert.equal(jobs.length, 48);
  assert.equal(new Set(jobs.map((j) => j.key)).size, 48);
});
test('driver grading rejects duplicate effects, exposed secrets, and sequential workers', () => {
  const scenario = driverCases.find((c) => c.id === 'driver-concurrent'),
    state = driverState();
  driverTransition(state, 'parallel', { reference: 'ALPHA' }, 'alpha');
  driverTransition(state, 'parallel', { reference: 'BETA' }, 'beta');
  assert.equal(scoreDriver(scenario, state, '', []).success, false);
  state.concurrentOverlap = true;
  state.laneOwners = { alpha: 'worker-a', beta: 'worker-b' };
  assert.equal(scoreDriver(scenario, state, '', []).success, true);
  state.secretExposed = true;
  assert.equal(scoreDriver(scenario, state, '', []).success, false);
  state.secretExposed = false;
  driverTransition(state, 'parallel', { reference: 'BETA' }, 'beta');
  assert.equal(scoreDriver(scenario, state, '', []).success, false);
});
test('payment checks hosted values without persisting card values in evidence', () => {
  const state = driverState();
  assert.ok(driverTransition(state, 'payment', {}).error);
  assert.equal(state.submissions, 0);
  driverTransition(state, 'payment', {
    ...driverSecrets,
    city: 'Portland',
    postal: '97205',
  });
  assert.equal(state.paymentValid, true);
  assert.equal(JSON.stringify(state).includes(driverSecrets.number), false);
});
