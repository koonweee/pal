export interface ReloadSafetyState {
  draft: string;
  pendingFiles: number;
  submitting: boolean;
  desktopOpen: boolean;
  dirtyForms: boolean;
}

export function canActivateUpdate(state: ReloadSafetyState) {
  return (
    !state.draft &&
    state.pendingFiles === 0 &&
    !state.submitting &&
    !state.desktopOpen &&
    !state.dirtyForms
  );
}
