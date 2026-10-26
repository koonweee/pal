import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReloadSafetyState } from './reload-safety';
import { canActivateUpdate } from './reload-safety';
import { onFrontendUpdateCheck } from './releases';
import { reconcileWebPush } from './web-push';
import { useUpdateMode } from './update-preference';

export function usePwaLifecycle(safety: ReloadSafetyState) {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const checking = useRef<Promise<void> | undefined>(undefined);
  const stopActivation = useRef<(() => void) | undefined>(undefined);
  const reloading = useRef(false);
  const safetyNow = useRef(safety);
  safetyNow.current = safety;
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
    let controller = navigator.serviceWorker.controller;
    const cleanup: Array<() => void> = [];
    const tracked = new WeakSet<ServiceWorker>();
    const reconcile = () => {
      if (!active) return;
      const next = navigator.serviceWorker.controller;
      if (next && next !== controller) {
        if (controller) externallyControlled.current = true;
        controller = next;
      }
      setNeedRefresh(
        externallyControlled.current || !!registration.current?.waiting,
      );
    };
    const track = (worker: ServiceWorker | null) => {
      if (!worker || tracked.has(worker)) return;
      tracked.add(worker);
      worker.addEventListener('statechange', reconcile);
      cleanup.push(() => worker.removeEventListener('statechange', reconcile));
    };
    navigator.serviceWorker.addEventListener('controllerchange', reconcile);
    window.addEventListener('pageshow', reconcile);
    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile();
    };
    document.addEventListener('visibilitychange', onVisible);
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((value) => {
        if (!active) return;
        setError(undefined);
        registration.current = value;
        void navigator.serviceWorker.ready.then((ready) =>
          reconcileWebPush(ready),
        );
        reconcile();
        track(value.waiting);
        track(value.installing);
        const onUpdateFound = () => {
          track(value.installing);
          reconcile();
        };
        value.addEventListener('updatefound', onUpdateFound);
        cleanup.push(() =>
          value.removeEventListener('updatefound', onUpdateFound),
        );
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
      stopActivation.current?.();
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        reconcile,
      );
      window.removeEventListener('pageshow', reconcile);
      document.removeEventListener('visibilitychange', onVisible);
      for (const dispose of cleanup) dispose();
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
    if (stopActivation.current || reloading.current) return;
    if (!canActivateUpdate(safetyNow.current)) {
      setDeferred(true);
      return;
    }
    setDeferred(false);
    setError(undefined);
    const value = registration.current;
    const target = value?.waiting ?? value?.active;
    if (!target) {
      setError('No application update is ready. Try again when connected.');
      return;
    }
    setBusy(true);
    const stop = () => {
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      target.removeEventListener('statechange', inspect);
      navigator.serviceWorker.removeEventListener('controllerchange', inspect);
      stopActivation.current = undefined;
    };
    const fail = (message: string) => {
      stop();
      setBusy(false);
      setError(message);
    };
    const inspect = () => {
      if (target.state === 'redundant') {
        fail('The update was replaced. Check for an update again.');
        return;
      }
      // A controller event can arrive before activation finishes. Polling also
      // handles a resumed iOS client that missed the event entirely.
      if (
        target.state !== 'activated' ||
        navigator.serviceWorker.controller !== target
      )
        return;
      stop();
      if (!canActivateUpdate(safetyNow.current)) {
        externallyControlled.current = true;
        setNeedRefresh(true);
        setDeferred(true);
        setBusy(false);
        return;
      }
      reloading.current = true;
      location.reload();
    };
    const poll = window.setInterval(inspect, 100);
    const timeout = window.setTimeout(
      () => fail('The update did not finish activating. Try again.'),
      10_000,
    );
    stopActivation.current = stop;
    target.addEventListener('statechange', inspect);
    navigator.serviceWorker.addEventListener('controllerchange', inspect);
    try {
      if (target === value?.waiting)
        target.postMessage({ type: 'SKIP_WAITING' });
      inspect();
    } catch (reason) {
      fail(
        reason instanceof Error
          ? reason.message
          : 'Could not activate the application update.',
      );
    }
  }, []);

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
      if (registration.current && needRefresh) activate();
      else if (registration.current) check();
      else setRegistrationAttempt((attempt) => attempt + 1);
    },
  };
}
