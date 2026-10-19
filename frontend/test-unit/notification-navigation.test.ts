import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useNotificationNavigation } from '../src/pwa/use-notification-navigation';

it('handles notification navigation in existing and cold clients without reloading', () => {
  const worker = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: worker,
  });
  history.replaceState(null, '', '/?notification=main');
  const openMain = vi.fn();
  const { unmount } = renderHook(() => useNotificationNavigation(openMain));
  expect(openMain).toHaveBeenCalledTimes(1);
  expect(location.search).toBe('');
  act(() =>
    worker.dispatchEvent(
      new MessageEvent('message', { data: { type: 'OPEN_MAIN' } }),
    ),
  );
  expect(openMain).toHaveBeenCalledTimes(2);
  unmount();
  worker.dispatchEvent(
    new MessageEvent('message', { data: { type: 'OPEN_MAIN' } }),
  );
  expect(openMain).toHaveBeenCalledTimes(2);
});
