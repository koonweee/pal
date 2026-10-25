import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNotificationBadge } from '../src/pwa/use-notification-badge';
import { markWebPushBadgeSeen } from '../src/pwa/web-push';

vi.mock('../src/pwa/web-push', () => ({ markWebPushBadgeSeen: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('acknowledges only a visible, focused Main view positioned at the latest messages and retries failures', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  let visibility = 'hidden';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility as DocumentVisibilityState,
  );
  const badge = {
    installationId: 'phone',
    generation: 1,
    count: 2,
    through: 5,
    revision: 5,
  };
  const node = document.createElement('div');
  Object.defineProperties(node, {
    clientHeight: { value: 400 },
    scrollHeight: { value: 1000 },
  });
  node.scrollTop = 600;
  const viewport = { current: node };
  const seen = vi.mocked(markWebPushBadgeSeen).mockResolvedValue(true);
  const { rerender, unmount } = renderHook(
    ({ active }) => useNotificationBadge(badge, active, viewport),
    { initialProps: { active: false } },
  );
  try {
    await act(() => vi.advanceTimersByTimeAsync(30));
    expect(seen).not.toHaveBeenCalled();
    rerender({ active: true });
    await act(() => vi.advanceTimersByTimeAsync(30));
    expect(seen).not.toHaveBeenCalled();
    visibility = 'visible';
    node.scrollTop = 0;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(30));
    expect(seen).not.toHaveBeenCalled();
    node.scrollTop = 600;
    seen.mockResolvedValueOnce(false);
    act(() => window.dispatchEvent(new Event('focus')));
    await act(() => vi.advanceTimersByTimeAsync(30));
    expect(seen).toHaveBeenCalledExactlyOnceWith(badge);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(seen).toHaveBeenCalledTimes(2);
    rerender({ active: false });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(seen).toHaveBeenCalledTimes(2);
  } finally {
    unmount();
  }
});
