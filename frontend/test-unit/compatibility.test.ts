import { expect, test } from 'vitest';
import { FIRST_PARTY_CONTRACT_VERSION } from '../src/api/contract';
import {
  assertCompatibleMutation,
  getCompatibilitySnapshot,
  observeCompatibility,
} from '../src/api/compatibility';

test('allows recovery reads and blocks mutations after a contract mismatch', () => {
  observeCompatibility(FIRST_PARTY_CONTRACT_VERSION - 1, 'next');
  expect(getCompatibilitySnapshot()).toMatchObject({
    compatible: false,
    receivedVersion: FIRST_PARTY_CONTRACT_VERSION - 1,
    releaseId: 'next',
  });
  expect(() => assertCompatibleMutation('GET')).not.toThrow();
  expect(() => assertCompatibleMutation('POST')).toThrow(/updated.*refresh/i);

  observeCompatibility(FIRST_PARTY_CONTRACT_VERSION, 'current');
  expect(getCompatibilitySnapshot().compatible).toBe(true);
  expect(() => assertCompatibleMutation('PATCH')).not.toThrow();
});
