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
  vi.spyOn(internal, 'connect').mockResolvedValue(browser);
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

it('bounds unresponsive private browser calls and fences handoff until device recovery', async () => {
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
    expect(coordinator.snapshot()[0].unavailable).toBe(true);
    await expect(
      coordinator.forSession(
        'desktop',
        { taskId: 'next', workerId: 'next' },
        async () => {},
      ),
    ).rejects.toThrow('uncertain');
  } finally {
    await coordinator.shutdown();
    vi.useRealTimers();
  }
});
