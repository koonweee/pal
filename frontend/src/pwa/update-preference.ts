import { useSyncExternalStore } from 'react';

export type UpdateMode = 'ask' | 'automatic-when-safe';

function storedMode(): UpdateMode {
  try {
    return localStorage.getItem('pal-update-mode') === 'automatic-when-safe'
      ? 'automatic-when-safe'
      : 'ask';
  } catch {
    return 'ask';
  }
}

let mode = storedMode();
const listeners = new Set<() => void>();

export function setUpdateMode(next: UpdateMode) {
  mode = next;
  try {
    localStorage.setItem('pal-update-mode', next);
  } catch {
    // The choice still applies to the current page.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdateMode() {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => 'ask',
  );
}
