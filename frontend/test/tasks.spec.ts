import { expect, test } from '@playwright/test';
import type { Message } from '../src/api/client';
import { backend, usePalBackend } from './support/pal-backend';

usePalBackend(test);

test('delegates into task chat, steers, receives a separate Main reply, archives, and reconnects', async ({
  page,
}) => {
  await page.route('**/vnc.html', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  );
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message pal' });
  await composer.fill('Delegate tickets');
  await composer.press('Enter');
  await expect(page.locator('#task-list')).toContainText('F1 tickets');
  await page.locator('#thread-open').click();
  await page
    .locator('#task-list')
    .getByRole('button', { name: /F1 tickets/ })
    .click();
  await expect(page.locator('#thread-open')).toHaveAttribute(
    'aria-label',
    /F1 tickets/,
  );
  await page.locator('#thread-open').click();
  await expect(page.locator('#task-description')).toHaveText(
    'Look for Friday tickets.',
  );
  await page.keyboard.press('Escape');
  const commentary: Message = {
    ...backend.message('Checking ticket sites'),
    taskId: backend.taskRows[0]!.id,
    phase: 'commentary',
    mainVisible: false,
  };
  backend.publish(commentary);
  await expect(page.locator('#messages')).toContainText(
    'Checking ticket sites',
  );
  await composer.fill('Friday only, under $500');
  await composer.press('Enter');
  await expect
    .poll(() => backend.submissions.at(-1)?.taskId)
    .toBe(backend.taskRows[0]!.id);
  expect(backend.submissions.at(-1)!.metadata.timezone).toBe(
    await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  await expect(page.locator('#messages')).toContainText(
    'Friday only, under $500',
  );
  await expect(page.locator('article.user .message-read')).toContainText(
    'Read ',
  );
  const final: Message = {
    ...backend.message('Friday tickets are available'),
    taskId: backend.taskRows[0]!.id,
    phase: 'final_answer',
    mainVisible: false,
  };
  backend.publish(final);
  const mainReply = backend.message('Friday tickets are available');
  backend.publish(mainReply);
  backend.taskRows[0] = {
    ...backend.taskRows[0]!,
    status: 'needs-input',
    version: 2,
  };
  backend.emit('task.updated', {
    event: 'task.updated',
    task: backend.taskRows[0],
  });
  await expect(page.locator('#task-status')).toHaveText('needs-input');
  await expect(page.locator(`[data-message-id="${final.id}"]`)).toHaveCount(1);
  await page.locator('#thread-open').click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.locator('#task-list [data-task-id]')).toHaveCount(0);
  await expect(page.locator('.activity-bubble')).toHaveAccessibleName('…');
  await page.getByLabel('Archived', { exact: true }).check();
  await expect(page.locator('#task-list')).toContainText('F1 tickets');
  await page.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await page.getByLabel('Archived', { exact: true }).uncheck();
  await expect(page.locator('#task-list')).toContainText('F1 tickets');
  await page.getByRole('button', { name: 'Main', exact: true }).click();
  await expect(page.locator('#messages')).not.toContainText(
    'Checking ticket sites',
  );
  await expect(page.locator('#messages')).not.toContainText(
    'Friday only, under $500',
  );
  await expect(page.locator(`[data-message-id="${final.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-message-id="${mainReply.id}"]`)).toHaveCount(
    1,
  );
  await page.locator('#thread-open').click();
  await page
    .locator('#task-list')
    .getByRole('button', { name: /F1 tickets/ })
    .click();
  for (const stream of backend.streams) stream.end();
  backend.streams.clear();
  // Updated while disconnected: snapshots must refresh both task and chat.
  backend.taskRows[0] = {
    ...backend.taskRows[0]!,
    status: 'completed',
    version: backend.taskRows[0]!.version + 1,
  };
  backend.rows = backend.rows.map((row) =>
    row.id === final.id
      ? { ...row, version: 2, text: 'Friday tickets confirmed' }
      : row,
  );
  await expect(page.locator('#task-status')).toHaveText('completed');
  await expect(page.locator('#messages')).toContainText(
    'Friday tickets confirmed',
  );
  await expect(page.locator(`[data-message-id="${final.id}"]`)).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const selector = page.getByRole('button', { name: /Open conversations/ });
  const sidebar = page.getByRole('dialog', { name: 'Conversations' });
  await expect(selector).toBeVisible();
  await expect(page.locator('#thread-nav')).not.toBeVisible();
  await expect(composer).toBeInViewport();
  await selector.click();
  await expect(sidebar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sidebar).not.toBeVisible();
  await expect(selector).toBeFocused();
  await selector.click();
  await page.mouse.click(380, 300);
  await expect(sidebar).not.toBeVisible();
  await selector.click();
  await sidebar.getByRole('button', { name: 'Main', exact: true }).click();
  await expect(sidebar).not.toBeVisible();
  await expect(selector).toHaveAttribute('aria-label', /Main/);
  await page.locator('#thread-open').click();
  await sidebar.getByRole('button', { name: /F1 tickets/ }).click();
  await expect(sidebar).not.toBeVisible();
  await expect(selector).toBeVisible();
  await expect(page.locator('#messages')).toContainText(
    'Friday tickets confirmed',
  );
  await selector.click();
  await sidebar.getByRole('button', { name: /F1 tickets/ }).click();
  await expect(sidebar).not.toBeVisible();
  await selector.click();
  await page.setViewportSize({ width: 1024, height: 844 });
  await expect(sidebar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sidebar).not.toBeVisible();
  await expect(page.locator('#thread-nav')).not.toBeVisible();
  await expect(page.locator('#thread-open')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(selector).toBeVisible();
  await expect(page.locator('#thread-nav')).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator('#task-list')).toContainText('F1 tickets');
  await expect(page.locator('#messages')).toContainText(
    'Friday tickets are available',
  );
});

test('retries failed snapshots while SSE stays connected and cancels obsolete detail retries', async ({
  page,
}) => {
  backend.rows = [backend.message('Recovered history')];
  backend.taskRows = [
    {
      id: 'retry-task',
      version: 1,
      createdAt: '2026-10-06T08:00:00.000Z',
      updatedAt: '2026-10-06T08:00:00.000Z',
      lastActivityAt: '2026-10-06T08:00:00.000Z',
      title: 'Retry task',
      goal: 'Recover reads',
      status: 'in-progress',
      archived: false,
      description: 'Recovered details',
    },
  ];
  const attempts = { history: 0, tasks: 0, details: 0 };
  let failDetails = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const key =
      path === '/api/chat/history'
        ? 'history'
        : path === '/api/tasks'
          ? 'tasks'
          : path === '/api/tasks/details/retry-task'
            ? 'details'
            : undefined;
    if (key) {
      attempts[key]++;
      if (
        attempts[key] <= (key === 'details' ? 1 : 2) ||
        (key === 'details' && failDetails)
      ) {
        await route.fulfill({ status: 503, body: 'Unavailable' });
        return;
      }
    }
    await route.continue();
  });
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('#history-error')).toContainText(
    'Retrying automatically',
  );
  await expect(page.locator('#connection')).toHaveAttribute(
    'data-connected',
    'true',
  );
  await expect(
    page.getByRole('button', { name: 'Refresh', exact: true }),
  ).toHaveCount(0);
  await page.clock.fastForward(2_000);
  await expect.poll(() => attempts.history).toBe(2);
  await expect.poll(() => attempts.tasks).toBe(2);
  await page.clock.fastForward(4_000);
  await expect(page.locator('#messages')).toContainText('Recovered history', {
    timeout: 5_000,
  });
  await expect(page.locator('#task-list')).toContainText('Retry task');
  expect(attempts.history).toBe(3);
  expect(attempts.tasks).toBe(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#thread-open').click();
  await page.getByRole('button', { name: /Retry task/ }).click();
  await page.clock.fastForward(2_000);
  await expect(page.locator('#task-description')).toHaveText(
    'Recovered details',
    { timeout: 5000 },
  );
  expect(attempts.details).toBe(2);
  failDetails = true;
  backend.emit('task.updated', {
    task: { ...backend.taskRows[0], version: 2 },
  });
  await expect.poll(() => attempts.details).toBe(3);
  await page.locator('#thread-open').click();
  await page.getByRole('button', { name: 'Main', exact: true }).click();
  await expect(page.locator('#thread-open')).toHaveAttribute(
    'aria-label',
    /Main/,
  );
  await page.clock.fastForward(31_000);
  expect(attempts.details).toBe(3);
  await expect.poll(() => backend.streams.size).toBe(1);
});
