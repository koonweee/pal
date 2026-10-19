import { useSyncExternalStore } from 'react';
import {
  disableWebPush,
  getWebPushConfig,
  registerWebPush,
} from '../api/client';

const supported = () =>
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;
interface NotificationState {
  ready: boolean;
  available: boolean;
  enabled: boolean;
  busy: boolean;
  denied: boolean;
  error?: string;
}
let state: NotificationState = {
  ready: false,
  available: false,
  enabled: false,
  busy: false,
  denied: false,
};
let registration: ServiceWorkerRegistration | undefined;
let installationId: string | undefined;
let publicKey: string | undefined;
const listeners = new Set<() => void>();
function update(patch: Partial<NotificationState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function report(error: unknown) {
  update({
    error:
      error instanceof Error
        ? error.message
        : 'Could not update notifications.',
  });
}
async function save(subscription: PushSubscription) {
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth)
    throw new Error('The browser returned an invalid push subscription.');
  const result = await registerWebPush({
    endpoint: subscription.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  });
  installationId = result.id;
}

/** Reads the registration owned by usePwaLifecycle; never registers a worker. */
export async function reconcileWebPush(value: ServiceWorkerRegistration) {
  if (!supported() || state.busy) return;
  registration = value;
  update({ busy: true, error: undefined });
  try {
    const config = await getWebPushConfig();
    publicKey = config.publicKey ?? undefined;
    const subscription = await value.pushManager.getSubscription();
    update({
      ready: true,
      available: config.available,
      enabled: subscription !== null,
      denied: Notification.permission === 'denied',
    });
    if (subscription && config.available) await save(subscription);
  } catch (error) {
    report(error);
  } finally {
    update({ busy: false });
  }
}

async function enable() {
  if (!registration || !publicKey || state.busy) return;
  update({ busy: true, error: undefined });
  try {
    // Keep permission directly on the user's click before asynchronous work.
    const permission = await Notification.requestPermission();
    update({ denied: permission === 'denied' });
    if (permission !== 'granted') return;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const bytes = Uint8Array.from(
        atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')),
        (character) => character.charCodeAt(0),
      );
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
    }
    update({ enabled: true });
    await save(subscription);
  } catch (error) {
    report(error);
  } finally {
    update({ busy: false });
  }
}

async function disable() {
  if (!registration || state.busy) return;
  update({ busy: true, error: undefined });
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (
      subscription &&
      !(await subscription.unsubscribe()) &&
      (await registration.pushManager.getSubscription())
    )
      throw new Error('Could not disable notifications. Please try again.');
    update({ enabled: false });
    const id = installationId;
    installationId = undefined;
    // Successful browser revocation is sufficient to stop alerts. A rejected
    // endpoint is also removed by backend delivery if cleanup cannot reach Pal.
    if (id) await disableWebPush(id).catch(() => undefined);
  } catch (error) {
    report(error);
  } finally {
    update({ busy: false });
  }
}

export function useWebPush() {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  return {
    ...snapshot,
    supported: supported(),
    enable,
    disable,
    retry: () => registration && reconcileWebPush(registration),
  };
}
