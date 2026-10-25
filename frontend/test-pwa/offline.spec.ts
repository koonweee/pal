import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { usePalBackend } from '../test/support/pal-backend';

usePalBackend(test);

test('installs the shell and keeps private routes network-only', async ({
  context,
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  const manifest = await page.request.get('/manifest.webmanifest');
  expect(await manifest.json()).toMatchObject({
    name: 'Pal',
    short_name: 'Pal',
    display: 'standalone',
    id: '/',
    start_url: '/',
  });

  const stream = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/stream',
  );
  await page.reload();
  expect((await stream).fromServiceWorker()).toBe(false);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller !== null),
  ).toBe(true);
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.locator('#connection')).toHaveText('Offline');
  await expect(page.locator('.activity-bubble')).toHaveCount(0);
  await expect(page.locator('.agent-label')).toBeVisible();
  await expect(page.locator('.agent-info')).toHaveAttribute(
    'data-connection',
    'offline',
  );
  await expect(page.locator('.agent-avatar')).toHaveCSS('opacity', '0.5');
  const dynamicRoutes = [
    '/manifest.webmanifest',
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
    '/api/chat/history',
    '/stream',
    '/desktop/v1/vnc.html',
    '/chat/history',
    '/tasks',
    '/files/example/content',
    '/preferences',
    '/instance-settings',
    '/mcp/oauth/callback',
    '/notifications/ios/installations/example',
    '/api/notifications/web/config',
    '/notifications/web/installations',
  ];
  for (const route of dynamicRoutes) {
    expect(
      await page.evaluate(async (path) => {
        try {
          await fetch(path);
          return true;
        } catch {
          return false;
        }
      }, route),
      `${route} must not fall back to a cached response`,
    ).toBe(false);
  }

  const cachedPaths = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      for (const response of await caches
        .open(name)
        .then((cache) => cache.keys()))
        paths.push(new URL(response.url).pathname);
    }
    return paths;
  });
  for (const route of dynamicRoutes) {
    expect(cachedPaths).not.toContain(route);
  }
});

test('defers a waiting update while a draft is active and activates it after clearing', async ({
  page,
}) => {
  const workerPath = resolve('dist/sw.js');
  const original = await readFile(workerPath, 'utf8');
  try {
    await page.goto('/');
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.reload();
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller !== null),
    ).toBe(true);
    await writeFile(workerPath, `${original}\n// waiting-update-test\n`);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });

    const update = page.locator('#pwa-update');
    await expect(update).toBeVisible();
    await page.locator('#draft').fill('Keep this draft');
    await update.getByRole('button', { name: 'Update', exact: true }).click();
    await update.getByRole('button', { name: 'Update details' }).click();
    await expect(page.getByRole('tooltip')).toContainText(
      'Finish or clear your draft',
    );
    await expect(page.locator('#draft')).toHaveValue('Keep this draft');
    expect(
      await page.evaluate(
        async () => !!(await navigator.serviceWorker.ready).waiting,
      ),
    ).toBe(true);

    await page.locator('#draft').fill('');
    await Promise.all([
      page.waitForEvent('load'),
      update.getByRole('button', { name: 'Update', exact: true }).click(),
    ]);
    await expect(update).toBeHidden();
    expect(
      await page.evaluate(
        async () => !!(await navigator.serviceWorker.ready).active,
      ),
    ).toBe(true);
  } finally {
    await writeFile(workerPath, original);
  }
});

test('automatic updates wait for safety and then reload', async ({ page }) => {
  const workerPath = resolve('dist/sw.js');
  const original = await readFile(workerPath, 'utf8');
  try {
    await page.addInitScript(() =>
      localStorage.setItem('pal-update-mode', 'automatic-when-safe'),
    );
    await page.goto('/');
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.reload();
    await page.locator('#draft').fill('Keep this automatic draft');
    await writeFile(workerPath, `${original}\n// automatic-update-test\n`);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });

    await expect(page.locator('#pwa-update')).toBeVisible();
    await expect(page.locator('#draft')).toHaveValue(
      'Keep this automatic draft',
    );
    await page.clock.install();
    await page.locator('#draft').fill('');
    await expect(page.locator('#pwa-update')).toContainText('Updating in 3s');
    await page.clock.runFor(1000);
    await expect(page.locator('#pwa-update')).toContainText('Updating in 2s');
    await page.clock.runFor(1000);
    await expect(page.locator('#pwa-update')).toContainText('Updating in 1s');
    await Promise.all([page.waitForEvent('load'), page.clock.runFor(1000)]);
    await expect(page.locator('#pwa-update')).toBeHidden();
  } finally {
    await writeFile(workerPath, original);
  }
});

test('reloads when an activating update does not emit controllerchange', async ({
  page,
}) => {
  const workerPath = resolve('dist/sw.js');
  const original = await readFile(workerPath, 'utf8');
  await page.addInitScript(() => {
    const container = navigator.serviceWorker;
    Object.defineProperty(container, 'addEventListener', {
      value(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (type !== 'controllerchange')
          EventTarget.prototype.addEventListener.call(
            container,
            type,
            listener,
            options,
          );
      },
    });
  });
  try {
    await page.goto('/');
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.reload();
    await writeFile(
      workerPath,
      `${original}\n// missing-controllerchange-test\n`,
    );
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });

    const update = page.locator('#pwa-update');
    await expect(update).toBeVisible();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await update.getByRole('button', { name: 'Update', exact: true }).click();
    // Activation must finish while SSE is open, before the reload fallback.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready;
          return (
            !registration.waiting && registration.active?.state === 'activated'
          );
        }),
      )
      .toBe(true);
    await Promise.all([page.waitForEvent('load'), page.clock.runFor(3000)]);
    await expect(page.locator('[data-react-shell="ready"]')).toBeVisible();
    await expect(update).toBeHidden();
  } finally {
    await writeFile(workerPath, original);
  }
});

test('discovers an update after the event stream reconnects', async ({
  page,
}) => {
  const workerPath = resolve('dist/sw.js');
  const original = await readFile(workerPath, 'utf8');
  await page.addInitScript(() => {
    let latest: TestEventSource | undefined;
    class TestEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = TestEventSource.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        latest = this;
        queueMicrotask(() => this.reconnect());
      }

      reconnect() {
        this.onopen?.(new Event('open'));
      }

      close() {
        this.readyState = TestEventSource.CLOSED;
      }
    }
    Object.defineProperty(window, 'EventSource', { value: TestEventSource });
    Object.defineProperty(window, '__palReconnectEventStream', {
      value: () => latest?.reconnect(),
    });
  });
  try {
    await page.goto('/');
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.locator('[data-react-shell="ready"]')).toBeVisible();

    await writeFile(workerPath, `${original}\n// reconnect-update-test\n`);
    await page.evaluate(() =>
      (
        window as typeof window & {
          __palReconnectEventStream(): void;
        }
      ).__palReconnectEventStream(),
    );
    await expect(page.locator('#pwa-update')).toBeVisible();
  } finally {
    await writeFile(workerPath, original);
  }
});

test('one tab updating does not reload another tab with active work', async ({
  context,
  page,
}) => {
  const workerPath = resolve('dist/sw.js');
  const original = await readFile(workerPath, 'utf8');
  const active = await context.newPage();
  try {
    await page.goto('/');
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.reload();
    await active.goto('/');
    await active.evaluate(async () => navigator.serviceWorker.ready);
    await active.reload();
    await active.locator('#draft').fill('Do not reload this tab');

    await writeFile(workerPath, `${original}\n// two-tab-update-test\n`);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });
    await expect(page.locator('#pwa-update')).toBeVisible();
    await Promise.all([
      page.waitForEvent('load'),
      page
        .locator('#pwa-update')
        .getByRole('button', { name: 'Update', exact: true })
        .click(),
    ]);

    await expect(active.locator('#draft')).toHaveValue(
      'Do not reload this tab',
    );
  } finally {
    await active.close();
    await writeFile(workerPath, original);
  }
});

test('requires an update after an incompatible backend response', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  await context.route('**/api/stream**', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: frontend.updated\ndata: {"event":"frontend.updated","releaseId":"test","contractVersion":2}\n\n',
    }),
  );
  await context.route('**/api/chat/history**', (route) =>
    route.fulfill({
      headers: { 'x-pal-contract-version': '999' },
      json: { messages: [], before: null },
    }),
  );
  await context.route('**/api/tasks**', (route) =>
    route.fulfill({
      headers: { 'x-pal-contract-version': '2' },
      json: { tasks: [], after: null },
    }),
  );
  await context.route('**/api/preferences**', (route) =>
    route.fulfill({
      headers: { 'x-pal-contract-version': '999' },
      json: { preferences: [], after: null },
    }),
  );

  try {
    await page.goto(baseURL!);
    await page.getByRole('button', { name: 'Preferences' }).click();
    const update = page.locator('#pwa-update');
    await expect(update).toContainText('Update required');
    await expect(
      update.getByRole('button', { name: 'Dismiss update notice' }),
    ).toHaveCount(0);
    await expect(
      update.getByRole('button', { name: 'Update', exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('retries service-worker registration after a transient failure', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  let workerRequests = 0;
  await context.route('**/sw.js', async (route) => {
    workerRequests++;
    if (workerRequests === 1) await route.abort('failed');
    else await route.continue();
  });
  const page = await context.newPage();
  try {
    await page.goto(baseURL!);
    const update = page.locator('#pwa-update');
    await expect(update).toContainText('Update failed');
    await update.getByRole('button', { name: 'Update', exact: true }).click();
    await expect.poll(() => workerRequests).toBeGreaterThanOrEqual(2);
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await expect(update).toBeHidden();
  } finally {
    await context.close();
  }
});
