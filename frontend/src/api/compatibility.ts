import { FIRST_PARTY_CONTRACT_VERSION } from './contract';

export const contractHeader = 'X-Pal-Contract-Version';
export const releaseHeader = 'X-Pal-Release-Id';

export interface CompatibilitySnapshot {
  compatible: boolean;
  expectedVersion: number;
  receivedVersion?: number;
  releaseId?: string;
}

let snapshot: CompatibilitySnapshot = {
  compatible: true,
  expectedVersion: FIRST_PARTY_CONTRACT_VERSION,
};
const listeners = new Set<() => void>();

function publish(update: Partial<CompatibilitySnapshot>) {
  snapshot = { ...snapshot, ...update };
  for (const listener of listeners) listener();
}

export function getCompatibilitySnapshot() {
  return snapshot;
}

export function subscribeCompatibility(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function observeCompatibility(
  version: string | number | undefined,
  releaseId?: string,
) {
  if (version === undefined) return;
  const receivedVersion = Number(version);
  publish({
    compatible: receivedVersion === FIRST_PARTY_CONTRACT_VERSION,
    receivedVersion,
    ...(releaseId ? { releaseId } : {}),
  });
}

export class CompatibilityError extends Error {
  constructor() {
    super('Pal updated. Refresh before making more changes.');
  }
}

export function assertCompatibleMutation(method: string) {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) &&
    !snapshot.compatible
  )
    throw new CompatibilityError();
}
