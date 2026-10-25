import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  getWebPushBadge,
  disableWebPush,
  getWebPushConfig,
  registerWebPush,
} from '../src/api/client';
import { reconcileWebPush, useWebPush } from '../src/pwa/web-push';

vi.mock('../src/api/client', () => ({
  getWebPushBadge: vi.fn(),
  getWebPushConfig: vi.fn(),
  registerWebPush: vi.fn(),
  disableWebPush: vi.fn(),
}));

it('opts in explicitly, reconciles on launch, and disables without a client recovery queue', async () => {
  const permission = vi.fn().mockResolvedValue('granted');
  vi.stubGlobal('Notification', {
    permission: 'default',
    requestPermission: permission,
  });
  vi.stubGlobal('PushManager', {});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: new EventTarget(),
  });
  let current: PushSubscription | null = null;
  const unsubscribe = vi.fn(async () => {
    current = null;
    return true;
  });
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/example',
    toJSON: () => ({ keys: { p256dh: 'public', auth: 'secret' } }),
    unsubscribe,
  } as unknown as PushSubscription;
  const subscribe = vi.fn(async () => {
    current = subscription;
    return subscription;
  });
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => current),
      subscribe,
    },
  } as unknown as ServiceWorkerRegistration;
  vi.mocked(getWebPushConfig).mockResolvedValue({
    available: true,
    publicKey: 'BA'.repeat(43),
  });
  vi.mocked(registerWebPush).mockResolvedValue({ id: 'installation' });
  vi.mocked(disableWebPush).mockResolvedValue(undefined);
  vi.mocked(getWebPushBadge).mockResolvedValue({
    installationId: 'installation',
    generation: 1,
    count: 0,
    through: 0,
    revision: 0,
  });
  const { result, unmount } = renderHook(useWebPush);
  try {
    await act(() => reconcileWebPush(registration));
    expect(subscribe).not.toHaveBeenCalled();
    expect(permission).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);

    permission.mockResolvedValueOnce('denied');
    await act(() => result.current.enable());
    expect(subscribe).not.toHaveBeenCalled();
    expect(result.current.denied).toBe(true);
    await act(() => result.current.enable());
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(result.current.enabled).toBe(true);
    await act(() => reconcileWebPush(registration));
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(registerWebPush).toHaveBeenLastCalledWith({
      endpoint: subscription.endpoint,
      keys: { p256dh: 'public', auth: 'secret' },
    });

    unsubscribe.mockRejectedValueOnce(new Error('Unsubscribe failed'));
    await act(() => result.current.disable());
    expect(result.current.enabled).toBe(true);
    expect(result.current.error).toBe('Unsubscribe failed');
    expect(disableWebPush).not.toHaveBeenCalled();
    vi.mocked(disableWebPush).mockRejectedValueOnce(
      new Error('Backend offline'),
    );
    await act(() => result.current.disable());
    expect(result.current.enabled).toBe(false);
    await act(() => reconcileWebPush(registration));
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(result.current.enabled).toBe(false);

    current = subscription;
    vi.mocked(registerWebPush).mockRejectedValueOnce(
      new Error('Registration failed'),
    );
    await act(() => reconcileWebPush(registration));
    expect(result.current.error).toBe('Registration failed');
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.error).toBeUndefined();
    expect(subscribe).toHaveBeenCalledTimes(1);
  } finally {
    unmount();
    vi.unstubAllGlobals();
  }
});
