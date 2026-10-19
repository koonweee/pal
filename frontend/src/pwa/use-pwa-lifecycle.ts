import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReloadSafetyState } from './reload-safety';
import { canActivateUpdate } from './reload-safety';
import { onFrontendUpdateCheck } from './releases';
import { reconcileWebPush } from './web-push';
import { useUpdateMode } from './update-preference';

export function usePwaLifecycle(safety: ReloadSafetyState) {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const checking = useRef<Promise<void> | undefined>(undefined);
  const reloadOnControl = useRef(false);
  const externallyControlled = useRef(false);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState<number>();
  const [deferred, setDeferred] = useState(false);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [error, setError] = useState<string>();
  const [registrationAttempt, setRegistrationAttempt] = useState(0);
  const [visible, setVisible] = useState(
    () => document.visibilityState !== 'hidden',
  );
  const mode = useUpdateMode();

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let active = true;
    let hadController = navigator.serviceWorker.controller !== null;
    const tracked = new WeakSet<ServiceWorker>();
    const track = (worker: ServiceWorker | null) => {
      if (!worker || tracked.has(worker)) return;
      tracked.add(worker);
      worker.addEventListener('statechange', () => {
        if (active && worker.state === 'installed' && hadController)
          setNeedRefresh(true);
      });
    };
    const onControllerChange = () => {
      if (!active) return;
      if (reloadOnControl.current) {
        location.reload();
        return;
      }
      if (hadController) {
        externallyControlled.current = true;
        setNeedRefresh(true);
      }
      hadController = true;
    };
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange,
    );
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((value) => {
        if (!value) throw new Error('Could not register application updates.');
        if (!active) return;
        setError(undefined);
        registration.current = value;
        void navigator.serviceWorker.ready.then((ready) =>
          reconcileWebPush(ready),
        );
        if (value.waiting && hadController) setNeedRefresh(true);
        track(value.installing);
        value.addEventListener('updatefound', () => track(value.installing));
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Could not register application updates.',
          );
      });
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange,
      );
    };
  }, [registrationAttempt]);

  useEffect(() => {
    const onVisibilityChange = () =>
      setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const check = useCallback(() => {
    if (!registration.current || checking.current) return;
    const pending = registration.current
      .update()
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Could not check for an application update.',
        );
      })
      .then(() => undefined)
      .finally(() => {
        if (checking.current === pending) checking.current = undefined;
      });
    checking.current = pending;
  }, []);

  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && check();
    const pageShow = () => check();
    const online = () => check();
    window.addEventListener('focus', visible);
    window.addEventListener('pageshow', pageShow);
    window.addEventListener('online', online);
    const release = onFrontendUpdateCheck(check);
    return () => {
      window.removeEventListener('focus', visible);
      window.removeEventListener('pageshow', pageShow);
      window.removeEventListener('online', online);
      release();
    };
  }, [check]);

  const activate = useCallback(() => {
    if (!canActivateUpdate(safety)) {
      setDeferred(true);
      return;
    }
    setDeferred(false);
    setBusy(true);
    const waiting = registration.current?.waiting;
    if (!waiting || externallyControlled.current) {
      location.reload();
      return;
    }
    reloadOnControl.current = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [safety]);

  const canCountDown =
    needRefresh &&
    mode === 'automatic-when-safe' &&
    canActivateUpdate(safety) &&
    !busy &&
    !error &&
    visible;

  useEffect(() => {
    if (!canCountDown) {
      setCountdown(undefined);
      return;
    }
    setCountdown(3);
    const interval = window.setInterval(
      () =>
        setCountdown((current) =>
          current !== undefined && current > 1 ? current - 1 : current,
        ),
      1000,
    );
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
      activate();
    }, 3000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [activate, canCountDown]);

  return {
    activate,
    busy,
    countdown,
    deferred,
    dismiss: () => setNeedRefresh(false),
    error,
    needRefresh,
    retry() {
      setError(undefined);
      if (registration.current) check();
      else setRegistrationAttempt((attempt) => attempt + 1);
    },
  };
}
