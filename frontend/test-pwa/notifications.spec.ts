import { expect, test } from '@playwright/test';
import { backend, usePalBackend } from '../test/support/pal-backend';

usePalBackend(test);

test('requests notification display while foregrounded and opens Main without losing a draft', async ({
  context,
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  const worker = context.serviceWorkers()[0]!;
  const notifications = await worker.evaluate(async () => {
    const scope = globalThis as unknown as {
      registration: ServiceWorkerRegistration;
      dispatchEvent(event: Event): boolean;
    };
    const displayed: { title: string; body?: string; tag?: string }[] = [];
    // Headless notification permission is platform-dependent. Replace only the
    // browser API; dispatch through the production worker's real handler.
    scope.registration.showNotification = async (title, options) => {
      displayed.push({ title, body: options?.body, tag: options?.tag });
    };
    const pending: Promise<unknown>[] = [];
    const event = new Event('push');
    Object.defineProperties(event, {
      data: {
        value: {
          json: () => ({
            title: 'Test Assistant',
            body: 'The result is ready',
            tag: 'push-test',
          }),
        },
      },
      waitUntil: { value: (work: Promise<unknown>) => pending.push(work) },
    });
    scope.dispatchEvent(event);
    await Promise.all(pending);
    return displayed;
  });
  expect(notifications).toEqual([
    { title: 'Test Assistant', body: 'The result is ready', tag: 'push-test' },
  ]);
  await page.locator('#draft').fill('Keep this draft');
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await worker.evaluate(async () => {
    const pending: Promise<unknown>[] = [];
    const event = new Event('notificationclick');
    Object.defineProperties(event, {
      notification: { value: { close() {} } },
      waitUntil: { value: (work: Promise<unknown>) => pending.push(work) },
    });
    globalThis.dispatchEvent(event);
    // Synthetic clicks do not carry the OS user activation needed for focus().
    await Promise.all(pending).catch((error: unknown) => {
      if (
        !(error instanceof DOMException) ||
        error.name !== 'InvalidAccessError'
      )
        throw error;
    });
  });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#draft')).toHaveValue('Keep this draft');
});

test('opens Main in a cold client using the fixed notification route', async ({
  page,
}) => {
  await page.goto('/?notification=main');
  await expect(page.locator('[data-react-shell="ready"]')).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe('');
  await expect(page.locator('#draft')).toBeVisible();
});

test('persists ordered badge snapshots across push, clearing, and disable', async ({
  context,
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  const worker = context.serviceWorkers()[0]!;
  const result = await worker.evaluate(async () => {
    const scope = globalThis as unknown as ServiceWorkerGlobalScope;
    const calls: number[] = [];
    Object.defineProperties(scope.navigator, {
      setAppBadge: {
        configurable: true,
        value: async (count: number) => {
          calls.push(count);
        },
      },
      clearAppBadge: {
        configurable: true,
        value: async () => {
          calls.push(0);
        },
      },
    });
    let displayed = 0;
    scope.registration.showNotification = async () => {
      displayed++;
    };
    const dispatch = async (name: string, data: object) => {
      const pending: Promise<unknown>[] = [];
      const event = new Event(name);
      Object.defineProperties(event, {
        data: { value: name === 'push' ? { json: () => data } : data },
        waitUntil: { value: (work: Promise<unknown>) => pending.push(work) },
      });
      scope.dispatchEvent(event);
      await Promise.all(pending);
    };
    const badge = {
      installationId: 'phone',
      generation: 1,
      count: 2,
      through: 2,
      revision: 2,
    };
    await dispatch('message', { type: 'BADGE_STATE', badge });
    await dispatch('push', {
      body: 'Older push',
      badge: { ...badge, count: 1, through: 1, revision: 1 },
    });
    await dispatch('message', {
      type: 'BADGE_STATE',
      badge: { ...badge, count: 0, revision: 4 },
    });
    await dispatch('push', { body: 'Delayed duplicate', badge });
    // Verify persisted ordering through an independent database connection.
    const saved = await new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open('pal-badge', 1);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('state', 'readonly');
        const request = tx.objectStore('state').get('current');
        request.onsuccess = () => resolve(request.result);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
      };
    });
    await dispatch('push', {
      body: 'Next',
      badge: { ...badge, count: 1, through: 3, revision: 5 },
    });
    await dispatch('message', { type: 'BADGE_DISABLED' });
    await dispatch('message', {
      type: 'BADGE_STATE',
      badge: { ...badge, count: 1, through: 3, revision: 5 },
    });
    await dispatch('push', {
      body: 'After disable',
      badge: { ...badge, count: 2, through: 4, revision: 6 },
    });
    await dispatch('message', {
      type: 'BADGE_STATE',
      badge: { ...badge, generation: 2, count: 0, through: 4, revision: 8 },
    });
    await dispatch('push', {
      body: 'Old generation',
      badge: { ...badge, revision: 100 },
    });
    Object.defineProperty(scope.navigator, 'setAppBadge', {
      configurable: true,
      value: async () => {
        throw new Error('OS badge unavailable');
      },
    });
    await dispatch('push', {
      body: 'Still show the alert',
      badge: { ...badge, generation: 2, count: 1, through: 5, revision: 9 },
    });
    return { calls, displayed, saved };
  });
  expect(result.calls).toEqual([2, 0, 1, 0, 0]);
  expect(result.displayed).toBe(6);
  expect(result.saved).toMatchObject({ count: 0, revision: 4, enabled: true });
});

test('acknowledges badges only when Main is visible at its latest messages', async ({
  context,
  page,
}) => {
  await page.addInitScript(() => {
    PushManager.prototype.getSubscription = async () =>
      ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/badge-test',
        toJSON: () => ({ keys: { p256dh: 'public', auth: 'secret' } }),
      }) as unknown as PushSubscription;
  });
  let badge = {
    installationId: 'phone',
    generation: 1,
    count: 0,
    through: 0,
    revision: 0,
  };
  const receipts: unknown[] = [];
  let reads = 0;
  let releaseBadge!: () => void;
  const badgeReady = new Promise<void>((resolve) => {
    releaseBadge = resolve;
  });
  await context.route('**/api/notifications/web/**', async (route) => {
    const url = new URL(route.request().url());
    let body: object;
    if (url.pathname.endsWith('/config'))
      body = { available: true, publicKey: 'BA'.repeat(43) };
    else if (url.pathname.endsWith('/installations')) body = { id: 'phone' };
    else {
      await badgeReady;
      if (route.request().method() === 'PUT') {
        receipts.push(route.request().postDataJSON());
        badge = { ...badge, count: 0, revision: badge.through * 2 };
      } else reads++;
      body = badge;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(() => {
    Object.defineProperties(navigator, {
      setAppBadge: { configurable: true, value: async () => {} },
      clearAppBadge: { configurable: true, value: async () => {} },
    });
  });
  releaseBadge();
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.locator('#connection')).toHaveText('Connected');
  await page.locator('#draft').fill('Keep my draft');
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  badge = { ...badge, count: 2, through: 2, revision: 2 };
  const readBefore = reads;
  const message = backend.message('The result is ready');
  message.notificationDestinationIds = ['web'];
  backend.publish(message);
  await expect.poll(() => reads).toBeGreaterThan(readBefore);
  expect(receipts).toEqual([]);
  await page
    .getByRole('button', { name: 'Close preferences', exact: true })
    .click();
  await expect.poll(() => receipts).toEqual([{ generation: 1, through: 2 }]);
  await expect(
    page.getByText('The result is ready', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('#draft')).toHaveValue('Keep my draft');

  for (let index = 0; index < 50; index++)
    backend.rows.push(backend.message(`Earlier conversation ${index}`));
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(
    page.getByText('Earlier conversation 49', { exact: true }),
  ).toBeVisible();
  const history = page.locator('#history');
  await expect
    .poll(() =>
      history.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
      ),
    )
    .toBeLessThan(2);
  await history.hover();
  await page.mouse.wheel(0, -700);
  await expect(
    page.getByRole('button', { name: 'Jump to latest', exact: true }),
  ).toBeVisible();
  badge = { ...badge, count: 1, through: 3, revision: 5 };
  const next = backend.message('Another result');
  next.notificationDestinationIds = ['web'];
  const beforeScrolledRead = reads;
  backend.publish(next);
  await expect.poll(() => reads).toBeGreaterThan(beforeScrolledRead);
  await expect(page.locator('#connection')).toHaveText('Connected');
  expect(receipts).toHaveLength(1);
  await page
    .getByRole('button', { name: 'Jump to latest', exact: true })
    .click();
  await expect
    .poll(() => receipts)
    .toEqual([
      { generation: 1, through: 2 },
      { generation: 1, through: 3 },
    ]);
});
