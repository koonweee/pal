import { expect, test } from '@playwright/test';
import { backend, usePalBackend } from './support/pal-backend';
usePalBackend(test);
test.use({ hasTouch: true });

test('shows global commentary, multiple-task navigation, and fresh reconnect state in a narrow header', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const now = new Date().toISOString();
  backend.taskRows = ['Planning', 'Tickets'].map((title, i) => ({
    id: 'task-' + i,
    title,
    goal: title,
    description: '',
    status: 'in-progress',
    archived: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  }));
  await page.request.patch('http://127.0.0.1:16991/instance-settings', {
    data: { agentName: 'Maple' },
  });
  await page.goto('/');
  await expect(page.locator('#connection')).toHaveAttribute(
    'data-connected',
    'true',
  );
  await expect(page.locator('.activity-bubble')).toHaveCount(0);
  await expect(page.locator('.agent-label')).toHaveText('Maple');
  await expect(page.locator('.connection')).toHaveCount(0);
  const message = {
    ...backend.message(
      'Checking Sam’s calendar and comparing every available afternoon next week to find a good time',
    ),
    taskId: 'task-0',
    phase: 'commentary' as const,
  };
  backend.publish(message);
  const running = [
    {
      id: 'task-0',
      title: 'Planning',
      commentary: {
        messageId: message.id,
        sequence: message.sequence,
        text: message.text,
      },
    },
  ];
  backend.emit('agent.activity', {
    state: { status: 'working', runningTasks: running },
  });
  const bubble = page.locator('.activity-bubble');
  await expect(bubble).toHaveAccessibleName(message.text);
  await expect(page.locator('.agent-label')).toHaveCount(0);
  expect(
    await page
      .locator('.activity-text')
      .evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  const bounds = await bubble.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  const desktop = await page.locator('#desktop-open').boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(desktop!.x);
  await bubble.click();
  await expect(page.locator('#messages')).toContainText(message.text);
  await page.locator('#thread-open').click();
  await page.locator('#main-chat').click();
  await expect(bubble).toHaveAccessibleName(message.text);
  backend.emit('agent.activity', {
    state: {
      status: 'working',
      runningTasks: [
        ...running,
        { id: 'task-1', title: 'Tickets', commentary: null },
      ],
    },
  });
  await expect(bubble).toHaveAccessibleName('working on 2 tasks');
  await bubble.click();
  await page
    .getByRole('dialog', { name: 'working on' })
    .getByRole('button', { name: 'Tickets' })
    .click();
  await expect(page.locator('#thread-open')).toHaveAccessibleName(/Tickets/);
  backend.emit('agent.activity', {
    state: {
      status: 'idle',
      needsInputTasks: [{ id: 'task-0', title: 'Planning' }],
    },
  });
  await expect(bubble).toHaveAccessibleName('need your input');
  for (const stream of backend.streams) stream.end();
  await expect(page.locator('#connection')).toHaveAttribute(
    'data-connected',
    'true',
  );
  await expect(bubble).toHaveAccessibleName('need your input');
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await expect(bubble).toHaveAccessibleName('need your input');
  await page.clock.install();
  const completion = {
    id: 'task-0',
    title: 'Planning',
    cueId: 'completed-planning',
    occurredAt: new Date(await page.evaluate(() => Date.now())).toISOString(),
  };
  const finished = page
    .getByRole('status')
    .filter({ hasText: 'Planning finished' });
  backend.emit('agent.activity', {
    state: {
      status: 'working',
      mainWorking: true,
      runningTasks: [{ id: 'task-1', title: 'Tickets', commentary: null }],
      latestCompletion: completion,
    },
  });
  await expect(bubble).toHaveAccessibleName('Tickets');
  await expect(finished).toHaveCount(1);
  await expect(page.locator('.activity-charm svg')).toBeVisible();
  expect(
    await page
      .locator('.activity-quest')
      .evaluate((node) => node.getAnimations({ subtree: true }).length),
  ).toBe(0);
  backend.emit('agent.activity', {
    state: {
      status: 'working',
      mainWorking: true,
      latestCompletion: completion,
    },
  });
  await expect(bubble).toHaveAccessibleName('…');
  await expect(finished).toHaveCount(1);
  const ticketMessage = {
    ...backend.message('Checking ticket options'),
    taskId: 'task-1',
    phase: 'commentary' as const,
  };
  backend.publish(ticketMessage);
  backend.emit('agent.activity', {
    state: {
      status: 'working',
      runningTasks: [
        {
          id: 'task-1',
          title: 'Tickets',
          commentary: {
            messageId: ticketMessage.id,
            sequence: ticketMessage.sequence,
            text: ticketMessage.text,
          },
        },
      ],
      latestCompletion: completion,
    },
  });
  await expect(bubble).toHaveAccessibleName(ticketMessage.text);
  await expect(finished).toHaveCount(1);
  await page.clock.fastForward(5_100);
  await expect(finished).toHaveCount(0);
  await expect(bubble).toHaveAccessibleName(ticketMessage.text);
  await page.emulateMedia({
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
  await expect
    .poll(() =>
      page
        .locator('.activity-quest')
        .evaluate((node) => node.getAnimations({ subtree: true }).length),
    )
    .toBeGreaterThan(0);
  const idleCompletion = {
    ...completion,
    cueId: 'another-completion',
    occurredAt: new Date(await page.evaluate(() => Date.now())).toISOString(),
  };
  backend.emit('agent.activity', {
    state: { status: 'idle', latestCompletion: idleCompletion },
  });
  await expect(bubble).toHaveAccessibleName('Planning finished');
  await bubble.click();
  await expect(page.locator('#thread-open')).toHaveAccessibleName(/Planning/);
  await page.clock.fastForward(5_100);
  await expect(bubble).toHaveCount(0);
  await expect(page.locator('.agent-label')).toHaveText('Maple');
});
