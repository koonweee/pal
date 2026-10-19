import { nextDeliveryState } from '../dist/adapters/secondary/delivery-dispatcher.service.js';

it('retries only known-safe outcomes and never retries uncertainty', () => {
  expect(
    nextDeliveryState({ kind: 'retryable', code: 'busy' }, 1, 1_000),
  ).toEqual({
    state: 'pending',
    errorCode: 'busy',
    nextAttemptAt: new Date(2_000),
  });
  expect(
    nextDeliveryState({ kind: 'retryable', code: 'busy' }, 4, 1_000),
  ).toEqual({ state: 'failed', errorCode: 'busy' });
  expect(
    nextDeliveryState({ kind: 'uncertain', code: 'timeout' }, 1, 1_000),
  ).toEqual({ state: 'uncertain', errorCode: 'timeout' });
});
