import { useSyncExternalStore } from 'react';
import { PlaygroundShell } from './PlaygroundShell';
import { UiWorkbench } from './ui/UiWorkbench';
import { WorkbenchApplicationPreview } from './ui/WorkbenchApplicationPreview';
import { usePwaLifecycle } from './pwa/use-pwa-lifecycle';
import {
  getCompatibilitySnapshot,
  subscribeCompatibility,
} from './api/compatibility';
import {
  ReloadSafetyProvider,
  useReloadSafety,
} from './pwa/ReloadSafetyProvider';
import { PwaUpdateNotice } from './pwa/PwaUpdateNotice';
import { useVisualViewportCssVars } from './layout/use-visual-viewport';

function PwaUpdate() {
  const { safety } = useReloadSafety();
  const compatibility = useSyncExternalStore(
    subscribeCompatibility,
    getCompatibilitySnapshot,
    getCompatibilitySnapshot,
  );
  const lifecycle = usePwaLifecycle(safety);
  const required = !compatibility.compatible;
  if (!lifecycle.needRefresh && !required && !lifecycle.error) return null;
  return (
    <PwaUpdateNotice
      busy={lifecycle.busy}
      countdown={lifecycle.countdown}
      deferred={lifecycle.deferred}
      error={lifecycle.error}
      required={required}
      onActivate={lifecycle.activate}
      onDismiss={lifecycle.dismiss}
      onRetry={lifecycle.retry}
    />
  );
}

export function App() {
  useVisualViewportCssVars();

  if (import.meta.env.DEV && location.pathname === '/__ui/preview') {
    return (
      <ReloadSafetyProvider>
        <WorkbenchApplicationPreview />
      </ReloadSafetyProvider>
    );
  }
  if (import.meta.env.DEV && location.pathname === '/__ui') {
    return (
      <ReloadSafetyProvider>
        <UiWorkbench />
      </ReloadSafetyProvider>
    );
  }
  return (
    <ReloadSafetyProvider>
      <PwaUpdate />
      <div data-react-shell="ready">
        <PlaygroundShell />
      </div>
    </ReloadSafetyProvider>
  );
}
