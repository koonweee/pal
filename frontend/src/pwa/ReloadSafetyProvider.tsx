import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { ReloadSafetyState } from './reload-safety';

const initialSafety: ReloadSafetyState = {
  draft: '',
  pendingFiles: 0,
  submitting: false,
  desktopOpen: false,
  dirtyForms: false,
};

interface ReloadSafetyContextValue {
  safety: ReloadSafetyState;
  update(update: Partial<ReloadSafetyState>): void;
}

const ReloadSafetyContext = createContext<ReloadSafetyContextValue | undefined>(
  undefined,
);

export function ReloadSafetyProvider({ children }: PropsWithChildren) {
  const [safety, setSafety] = useState(initialSafety);
  const update = useCallback(
    (next: Partial<ReloadSafetyState>) =>
      setSafety((current) => ({ ...current, ...next })),
    [],
  );
  const value = useMemo(() => ({ safety, update }), [safety, update]);
  return (
    <ReloadSafetyContext.Provider value={value}>
      {children}
    </ReloadSafetyContext.Provider>
  );
}

export function useReloadSafety() {
  const context = useContext(ReloadSafetyContext);
  if (!context) throw new Error('Reload safety requires ReloadSafetyProvider');
  return context;
}
