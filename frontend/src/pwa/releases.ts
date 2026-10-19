import { FIRST_PARTY_CONTRACT_VERSION } from '../api/contract';
import { observeCompatibility } from '../api/compatibility';

export interface FrontendRelease {
  releaseId: string;
  contractVersion: number;
}

const listeners = new Set<() => void>();

export function requestFrontendUpdateCheck() {
  for (const listener of listeners) listener();
}

export function observeFrontendRelease(release: FrontendRelease) {
  observeCompatibility(release.contractVersion, release.releaseId);
  if (
    release.releaseId === __PAL_RELEASE_ID__ &&
    release.contractVersion === FIRST_PARTY_CONTRACT_VERSION
  )
    return;
  requestFrontendUpdateCheck();
}

export function onFrontendUpdateCheck(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
