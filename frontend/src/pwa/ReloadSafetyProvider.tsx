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
  update(update: Partial<Omit<ReloadSafetyState, 'credentialEditing'>>): void;
  beginCredentialEditing(): () => void;
}

const ReloadSafetyContext = createContext<ReloadSafetyContextValue | undefined>(
  undefined,
);

export function ReloadSafetyProvider({ children }: PropsWithChildren) {
  const [safety, setSafety] = useState(initialSafety);
  const [credentialEditors, setCredentialEditors] = useState(0);
  const beginCredentialEditing = useCallback(() => {
    setCredentialEditors((count) => count + 1);
    return () => setCredentialEditors((count) => count - 1);
  }, []);
  const update = useCallback(
    (next: Partial<Omit<ReloadSafetyState, 'credentialEditing'>>) =>
      setSafety((current) => ({ ...current, ...next })),
    [],
  );
  const value = useMemo(
    () => ({
      safety: { ...safety, credentialEditing: credentialEditors > 0 },
      update,
      beginCredentialEditing,
    }),
    [safety, update, beginCredentialEditing, credentialEditors],
  );
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
