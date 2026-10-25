import { expect, test } from '@playwright/test';
import { backend, usePalBackend } from './support/pal-backend';

usePalBackend(test);

function question() {
  const message = {
    ...backend.message('How many people are coming?'),
    suggestedReplies: ['Just me', 'Two people', 'A small group'],
  };
  backend.rows.push(message);
  return message;
}

test('sends with the existing animation, preserves the composer, and clears replies on both clients and reload', async ({
  page,
  context,
}) => {
  const source = question();
  await page.route('**/api/files', async (route) => {
    const attachment = {
      id: 'notes-file',
      filename: 'notes.txt',
      contentType: 'text/plain',
      sizeBytes: 16,
      createdAt: new Date().toISOString(),
    };
    backend.uploadedFiles.set(attachment.id, attachment);
    await route.fulfill({ status: 201, json: { attachment } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Object.defineProperty(window, 'pillExits', {
      value: [],
      configurable: true,
    });
    document.addEventListener('transitionrun', (event) => {
      if (
        event instanceof TransitionEvent &&
        event.target instanceof Element &&
        event.target.matches('.suggested-replies[data-visible="false"]')
      )
        (window as unknown as { pillExits: string[] }).pillExits.push(
          event.propertyName,
        );
    });
    Object.defineProperty(window, 'sendAnimations', {
      value: [],
      configurable: true,
    });
    Element.prototype.animate = function (...args) {
      if (
        this.matches('.message-swipe-row') &&
        this.querySelector('article.user')
      )
        (
          window as unknown as { sendAnimations: unknown[] }
        ).sendAnimations.push(args[0]);
      return animate.apply(this, args);
    };
  });
  const other = await context.newPage();
  await Promise.all([page.goto('/'), other.goto('/')]);
  const choices = page.getByRole('group', { name: 'Suggested replies' });
  const remoteChoices = other.getByRole('group', { name: 'Suggested replies' });
  await expect(choices.getByRole('button')).toHaveCount(3);
  expect(
    (await choices.getByRole('button').first().boundingBox())!.height,
  ).toBe(44);
  await expect(remoteChoices).toBeVisible();
  await page
    .getByRole('button', { name: 'Reply to pal’s message' })
    .click({ force: true });
  await page
    .getByRole('textbox', { name: 'Message pal' })
    .fill('Keep this draft');
  await page.locator('#file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Keep this upload'),
  });
  await expect(page.locator('#pending-files')).toContainText('Ready');
  backend.holdNextSend = true;
  await choices
    .getByRole('button', { name: 'Two people', exact: true })
    .click();
  try {
    await expect.poll(() => Boolean(backend.releasePersistence)).toBe(true);
    await expect(page.locator('article.user')).toHaveCount(1);
    await expect(page.locator('article.user')).toContainText('Two people');
    await expect(page.locator('article.user')).toHaveAttribute(
      'data-message-id',
      /^local-/,
    );
    await expect(choices).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { pillExits: string[] }).pillExits.length,
        ),
      )
      .toBeGreaterThan(0);
    const exiting = page.locator(
      `[data-message-id="${source.id}"] .suggested-replies`,
    );
    await expect
      .poll(async () => (await exiting.boundingBox())?.height)
      .toBe(0);
    await expect(remoteChoices).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Message pal' }),
    ).toHaveValue('Keep this draft');
    await expect(page.locator('#pending-files')).toContainText('notes.txt');
    await expect(page.locator('#composer-reply')).toContainText(source.text);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { sendAnimations: unknown[] }).sendAnimations
              .length,
        ),
      )
      .toBeGreaterThan(0);
    expect(backend.submissions[0]).toMatchObject({
      text: '',
      suggestedReply: { messageId: source.id, index: 1 },
      attachmentIds: [],
    });
    expect(backend.submissions[0].replyToMessageId).toBeUndefined();
    backend.releasePersistence!();
    await expect.poll(() => Boolean(backend.releaseAcceptance)).toBe(true);
    await expect(remoteChoices).toHaveCount(0);
    await expect(other.locator('article.user')).toHaveCount(1);
    await expect(other.locator('article.user')).toContainText('Two people');
    await expect(page.locator('article.user')).not.toHaveAttribute(
      'data-message-id',
      /^local-/,
    );
    await expect(page.locator('article.user .message-read')).toHaveAttribute(
      'data-status',
      /delivered|read/,
    );
    backend.releaseAcceptance!();
    await other.reload();
    await expect(remoteChoices).toHaveCount(0);
    await expect(other.locator('article.user')).toHaveCount(1);
    expect(
      backend.rows.find((message) => message.id === source.id)
        ?.suggestedReplies,
    ).toEqual([]);
    expect(backend.submissions).toHaveLength(1);
    await page.screenshot({
      path: 'test-results/suggested-replies-sent-mobile.png',
    });
  } finally {
    backend.releasePersistence?.();
    backend.releaseAcceptance?.();
    await other.close();
  }
});

test('retries a failed suggestion with the original selection and idempotency key', async ({
  page,
}) => {
  const source = question();
  const requests: object[] = [];
  await page.route('**/api/chat/messages', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: 'Temporarily unavailable' },
      });
    else await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Just me', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry sending message' }),
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Suggested replies' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry sending message' }).click();
  await expect.poll(() => backend.submissions.length).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Retry sending message' }),
  ).toHaveCount(0);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[1]).toMatchObject({
    suggestedReply: { messageId: source.id, index: 0 },
  });
  await expect(page.locator('article.user')).toHaveCount(1);
  await expect(page.locator('article.user')).toContainText('Just me');
});

test('removes a losing optimistic send after a selection conflict', async ({
  page,
}) => {
  const source = question();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/chat/messages', async (route) => {
    backend.publish({ ...source, suggestedReplies: [], version: 2 });
    await route.fulfill({
      status: 409,
      json: { message: 'Suggested reply is no longer available.' },
    });
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'A small group', exact: true })
    .click();
  await expect(
    page.getByRole('group', { name: 'Suggested replies' }),
  ).toHaveCount(0);
  await expect(page.locator('article.user')).toHaveCount(0);
  const collapsed = page.locator('.suggested-replies');
  expect((await collapsed.boundingBox())?.height).toBe(0);
  expect(await collapsed.evaluate((node) => node.getAnimations().length)).toBe(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'Retry sending message' }),
  ).toHaveCount(0);
});
