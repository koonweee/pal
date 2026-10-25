import { expect, test } from '@playwright/test';
import { backend, usePalBackend } from './support/pal-backend';

usePalBackend(test);

test('truncates long quotes within user and assistant bubbles', async ({
  page,
}) => {
  const target = backend.message(
    'The white charging stand is **unavailable again** as of the latest inventory check. Both colors are now unavailable at both stores.',
  );
  backend.rows.push(target);
  const replies = (['user', 'assistant'] as const).map((role) => ({
    ...backend.message('How quickly did it sell out?', role),
    replyToMessageId: target.id,
    replyTo: {
      id: target.id,
      sequence: target.sequence,
      role: target.role,
      textPreview: target.text,
      taskId: target.taskId,
      phase: target.phase,
      mainVisible: target.mainVisible,
    },
  }));
  backend.rows.push(...replies);

  for (const width of [320, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    for (const reply of replies) {
      const message = page.locator(`[data-message-id="${reply.id}"]`);
      await expect(
        message.getByRole('button', { name: 'View quoted message' }),
      ).toContainText(target.text);
      await expect
        .poll(() =>
          message.evaluate((article) => {
            const bubble = article.querySelector('.message-bubble')!;
            const quote = article.querySelector('.message-quote span')!;
            const body = article.querySelector('.message-body')!;
            const bounds = article.getBoundingClientRect();
            const bubbleBounds = bubble.getBoundingClientRect();
            const bodyBounds = body.getBoundingClientRect();
            return {
              bubbleFits:
                bubbleBounds.left >= bounds.left - 1 &&
                bubbleBounds.right <= bounds.right + 1,
              bodyFits:
                bodyBounds.left >= bubbleBounds.left &&
                bodyBounds.right <= bubbleBounds.right,
              quoteTruncated: quote.scrollWidth > quote.clientWidth,
              quoteIsSingleLine: quote.getBoundingClientRect().height < 24,
            };
          }),
        )
        .toEqual({
          bubbleFits: true,
          bodyFits: true,
          quoteTruncated: true,
          quoteIsSingleLine: true,
        });
    }
  }
});
