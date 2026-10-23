export interface ReloadSafetyState {
  credentialEditing?: boolean;
  draft: string;
  pendingFiles: number;
  submitting: boolean;
  desktopOpen: boolean;
  dirtyForms: boolean;
}

export function canActivateUpdate(state: ReloadSafetyState) {
  return (
    !state.credentialEditing &&
    !state.draft &&
    state.pendingFiles === 0 &&
    !state.submitting &&
    !state.desktopOpen &&
    !state.dirtyForms
  );
}
