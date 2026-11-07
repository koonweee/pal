import { ConfigService } from '@nestjs/config';
import type { Browser, Page } from 'playwright-core';
import type { ExecutionService } from '../dist/execution/execution.service.js';
import { SharedBrowserService } from '../dist/browser/shared-browser.service.js';
import { extensionRequest } from '../dist/browser/browser-extension.js';
import { LoginDestinations } from '../dist/login/login-destinations.js';
import { InteractionCoordinator } from '../dist/interaction/interaction-coordinator.js';
import type { AndroidService } from '../dist/android/android.service.js';

vi.mock('../dist/browser/browser-extension.js', () => ({
  extensionRequest: vi.fn(),
}));

it('binds private inspection to the active tab, retains its target, and disconnects without closing tabs', async () => {
  const service = new SharedBrowserService(
    new ConfigService({ PAL_DESKTOP_ENABLED: true }),
    {} as ExecutionService,
  );
  const closeTab = vi.fn();
  const page = (id: string) =>
    ({
      isClosed: () => false,
      close: closeTab,
      context: () => ({
        newCDPSession: async () => ({
          send: async () => ({ targetInfo: { targetId: id } }),
          detach: async () => {},
        }),
      }),
    }) as unknown as Page;
  const first = page('first');
  const second = page('second');
  const disconnect = vi.fn(async () => {});
  const browser = {
    contexts: () => [{ pages: () => [first, second] }],
    close: disconnect,
  } as unknown as Browser;
  const internal = service as unknown as {
    connect(): Promise<Browser>;
    endpoint(): Promise<string>;
  };
  const connect = vi.spyOn(internal, 'connect').mockResolvedValue(browser);
  await expect(service.selectedPage('task', 'worker')).rejects.toThrow();
  expect(connect).not.toHaveBeenCalled();
  vi.spyOn(internal, 'endpoint').mockResolvedValue('ws://fixture');
  vi.mocked(extensionRequest).mockResolvedValue({ targetId: 'first' });
  expect(await service.selectedPage('task', 'worker', true)).toBe(first);
  vi.mocked(extensionRequest).mockResolvedValue({ targetId: 'second' });
  expect(await service.selectedPage('task', 'worker')).toBe(first);
  expect(await service.selectedPage('other', 'worker', true)).toBe(second);
  vi.spyOn(first, 'isClosed').mockReturnValue(true);
  await expect(service.selectedPage('task', 'worker')).rejects.toThrow(
    'closed',
  );
  expect(await service.selectedPage('task', 'worker', true)).toBe(second);
  Object.assign(service, { browser });
  await service.shutdown();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(closeTab).not.toHaveBeenCalled();
});

it('closes only pages created by a completed worker and retains continuations', async () => {
  const service = new SharedBrowserService(
    new ConfigService({ PAL_DESKTOP_ENABLED: true }),
    {} as ExecutionService,
  );
  const internal = service as unknown as {
    endpoint(): Promise<string>;
  };
  vi.spyOn(internal, 'endpoint').mockResolvedValue('ws://fixture');
  vi.mocked(extensionRequest)
    .mockResolvedValueOnce({ targetIds: ['existing'] })
    .mockResolvedValueOnce({ targetIds: ['existing', 'created', 'popup'] })
    .mockResolvedValueOnce({ targetIds: ['existing', 'created', 'popup'] })
    .mockResolvedValueOnce({ closedCount: 2 });

  expect(await service.beginWorker('task', 'worker')).toBe(true);
  expect(await service.finishWorker('task', 'worker', true)).toMatchObject({
    tracked: true,
    retained: true,
    currentPageCount: 3,
    createdPageCount: 2,
    closedPageCount: 0,
  });
  await expect(service.finishWorker('task', 'worker', false)).resolves.toEqual({
    tracked: true,
    retained: false,
    baselinePageCount: 1,
    currentPageCount: 3,
    createdPageCount: 2,
    closedPageCount: 2,
  });
  expect(extensionRequest).toHaveBeenLastCalledWith('ws://fixture', {
    action: 'close',
    targetIds: ['created', 'popup'],
  });
});

it('bounds private browser calls without disabling later turns', async () => {
  vi.useFakeTimers();
  const coordinator = new InteractionCoordinator();
  try {
    const destinations = new LoginDestinations(
      {
        selectedPage: () => new Promise(() => {}),
      } as unknown as SharedBrowserService,
      {} as AndroidService,
      coordinator,
    );
    const failed = expect(
      destinations.inspect('task', 'worker', 'browser'),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    const next = coordinator.forSession(
      'desktop',
      { taskId: 'next', workerId: 'next' },
      async () => {},
    );
    await next;
  } finally {
    coordinator.shutdown();
    vi.useRealTimers();
  }
});
