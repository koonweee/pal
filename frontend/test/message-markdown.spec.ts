import { expect, test } from '@playwright/test';
import { backend, usePalBackend } from './support/pal-backend';

usePalBackend(test);

const markdown =
  '**Hello** [Open](https://example.com)\n\n- first\n- second\n\n`inline`\n\n```ts\nconst ok = true;\n```\n\n> quoted';

test('renders Markdown for both message roles with readable user bubbles', async ({
  page,
}) => {
  const messages = (['user', 'assistant'] as const).map((role) =>
    backend.message(markdown, role),
  );
  backend.rows.push(...messages);

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto('/');
    for (const message of messages) {
      const body = page
        .locator(`[data-message-id="${message.id}"]`)
        .locator('.message-body');
      await expect(body.locator('strong')).toHaveText('Hello');
      await expect(body.getByRole('listitem')).toHaveText(['first', 'second']);
      await expect(body.locator('pre code')).toHaveText('const ok = true;\n');
      await expect(body.getByRole('link', { name: 'Open' })).toHaveAttribute(
        'rel',
        'noopener noreferrer',
      );
      if (message.role === 'user') {
        const foreground = await body.evaluate(
          (node) => getComputedStyle(node).color,
        );
        await expect(body.getByRole('link')).toHaveCSS('color', foreground);
        await expect(body.locator('blockquote')).toHaveCSS('color', foreground);
        const codeColor = await body
          .locator('pre code')
          .evaluate((node) => getComputedStyle(node).color);
        const codeBackground = await body
          .locator('pre')
          .evaluate((node) => getComputedStyle(node).backgroundColor);
        expect(codeColor).not.toBe(codeBackground);
      }
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test('contains wide and nested ordered-list markers in both message roles', async ({
  page,
}) => {
  const text =
    '3499. **Roommate** is not the neatest. Master bedroom, but laundry is in the master bathroom so access is occasionally shared.\n      1. Nested item\n      2. Nested item two\n3500. Second item\n\nBetween lists.\n\n123456789. Largest CommonMark marker';
  const messages = (['user', 'assistant'] as const).map((role) =>
    backend.message(text, role),
  );
  backend.rows.push(...messages);

  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/');

  for (const message of messages) {
    const article = page.locator(`[data-message-id="${message.id}"]`);
    const bubble = article.locator('.message-bubble');
    const body = article.locator('.message-body');
    const lists = body.locator('ol.message-ordered-list');
    await expect(lists).toHaveCount(3);
    await expect(lists.first()).toHaveAttribute('start', '3499');
    await expect(body.locator('.message-list-marker')).toHaveText([
      '3499.',
      '1.',
      '2.',
      '3500.',
      '123456789.',
    ]);
    await expect(body.locator('strong')).toHaveText('Roommate');

    const bubbleBounds = (await bubble.boundingBox())!;
    for (const part of await body
      .locator('.message-list-marker, .message-list-content')
      .all()) {
      const bounds = (await part.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(bubbleBounds.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        bubbleBounds.x + bubbleBounds.width,
      );
    }
  }
});

test('keeps Markdown source in the composer and renders optimistic and saved sends', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#connection')).toHaveText('Connected');
  const composer = page.getByRole('textbox', { name: 'Message pal' });
  const text = '**Sent** with `code`';
  await composer.fill(text);
  await expect(composer).toHaveValue(text);
  backend.holdNextSend = true;
  try {
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect.poll(() => Boolean(backend.releasePersistence)).toBe(true);
    const user = page.getByRole('article', { name: 'You', exact: true });
    await expect(user.locator('strong')).toHaveText('Sent');
    await expect(user.locator('code')).toHaveText('code');
    expect(backend.submissions[0]!.text).toBe(text);
    backend.releasePersistence!();
    await expect.poll(() => Boolean(backend.releaseAcceptance)).toBe(true);
    backend.releaseAcceptance!();
    await expect(composer).toHaveValue('');
    await page.reload();
    await expect(user).toHaveCount(1);
    await expect(user.locator('strong')).toHaveText('Sent');
    await expect(user.locator('code')).toHaveText('code');
  } finally {
    backend.releasePersistence?.();
    backend.releaseAcceptance?.();
  }
});
