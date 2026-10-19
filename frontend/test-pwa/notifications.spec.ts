import { expect, test } from '@playwright/test';

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
