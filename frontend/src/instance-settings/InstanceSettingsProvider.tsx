import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  getInstanceSettings,
  updateInstanceSettings,
  type InstanceSettings,
  type SaveInstanceSettings,
} from '../api/client';
import { lightTheme } from '../theme/tokens';
import { readAppearanceCache, writeAppearanceCache } from './appearance-cache';

export const defaultInstanceSettings: InstanceSettings = {
  agentName: 'pal',
  agentAvatarAttachmentId: null,
  accentColor: lightTheme.colors.accent,
  version: 0,
};
interface InstanceSettingsContextValue {
  settings: InstanceSettings;
  ready: boolean;
  error?: string;
  refresh(): Promise<void>;
  save(input: SaveInstanceSettings): Promise<InstanceSettings>;
}
const Context = createContext<InstanceSettingsContextValue | undefined>(
  undefined,
);

export function InstanceSettingsProvider({
  children,
  preview = false,
}: PropsWithChildren<{ preview?: boolean }>) {
  const [settings, setSettings] = useState<InstanceSettings>(() => ({
    ...defaultInstanceSettings,
    ...(preview ? undefined : readAppearanceCache()),
  }));
  const [ready, setReady] = useState(preview);
  const [error, setError] = useState<string>();
  const read = useRef<AbortController | undefined>(undefined);
  const apply = useCallback((next: InstanceSettings) => {
    setSettings((current) =>
      next.version >= current.version ? next : current,
    );
    setReady(true);
    setError(undefined);
  }, []);
  const refresh = useCallback(async () => {
    if (preview) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    try {
      const next = await getInstanceSettings(controller.signal);
      if (!controller.signal.aborted) apply(next);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not load instance settings',
        );
    }
  }, [apply, preview]);
  const save = useCallback(
    async (input: SaveInstanceSettings) => {
      if (preview) {
        const next = { ...settings, ...input, version: settings.version + 1 };
        apply(next);
        return next;
      }
      const next = await updateInstanceSettings(input);
      apply(next);
      return next;
    },
    [apply, preview, settings],
  );
  useEffect(() => {
    void refresh();
    return () => read.current?.abort();
  }, [refresh]);
  useEffect(() => {
    if (ready && !preview) writeAppearanceCache(settings);
  }, [preview, ready, settings]);
  const value = useMemo(
    () => ({ settings, ready, error, refresh, save }),
    [settings, ready, error, refresh, save],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useInstanceSettings() {
  const context = useContext(Context);
  if (!context)
    throw new Error('Instance settings require InstanceSettingsProvider');
  return context;
}
