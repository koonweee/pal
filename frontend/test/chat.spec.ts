import { expect, test } from '@playwright/test';
import type { Message } from '../src/api/client';
import { backend, usePalBackend } from './support/pal-backend';

usePalBackend(test);

test('segments messages by date with compact local labels', async ({
  page,
}) => {
  const now = new Date(2026, 9, 18, 12);
  await page.clock.setFixedTime(now);
  for (const [text, date] of [
    ['Earlier year', new Date(2025, 11, 31, 12)],
    ['Earlier this year', new Date(2026, 9, 13, 12)],
    ['Yesterday message', new Date(2026, 9, 17, 12)],
    ['Today one', new Date(2026, 9, 18, 9)],
    ['Today two', new Date(2026, 9, 18, 10)],
  ] as const) {
    const message = backend.message(text);
    backend.rows.push({
      ...message,
      createdAt: date.toISOString(),
      updatedAt: date.toISOString(),
    });
  }

  await page.goto('/');
  const separators = page.getByRole('separator');
  await expect(separators).toHaveText([
    'Dec 31 2025',
    'Oct 13',
    'Yesterday',
    'Today',
  ]);
  await expect(separators).toHaveCount(4);
  await expect(separators.first()).toHaveCSS('text-align', 'center');
  await expect(separators.first()).toHaveCSS('font-size', '13px');
});

test('reconciles snapshots, live follow-ups, older history, reconnect, and reload', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  for (let i = 1; i <= 75; i++)
    backend.rows.push(backend.message(`Message ${i}`));
  backend.holdNextHistory = true;
  await page.route('**/vnc.html', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  );
  await page.goto('/');
  await expect(page.locator('#desktop-status')).toHaveText(
    'Desktop unavailable. Chat is still available.',
  );
  await expect.poll(() => Boolean(backend.releaseHistory)).toBe(true);
  await expect(page.locator('#connection')).toHaveAttribute(
    'data-syncing',
    'true',
  );
  await expect(page.locator('#connection')).toHaveText('Syncing history…');
  const newest = {
    ...backend.rows[74]!,
    version: 2,
    text: '**Updated while loading** <img src=x onerror="window.unsafe=true"><script>window.unsafe=true</script> [unsafe](javascript:alert(1))',
  };
  backend.publish(newest);
  backend.releaseHistory!();
  await expect(page.locator('#connection')).toHaveAttribute(
    'data-syncing',
    'false',
  );
  const articles = page.locator('article.message');
  await expect(
    page.locator(`[data-message-id="${newest.id}"]`).locator('strong'),
  ).toHaveText('Updated while loading');
  await expect(
    page
      .locator(`[data-message-id="${newest.id}"]`)
      .locator('img, script, a[href^="javascript:"]'),
  ).toHaveCount(0);
  expect(await articles.count()).toBeLessThan(30);
  const history = page.locator('#history');
  const oldestLoaded = page.getByText('Message 46', { exact: true });
  backend.holdNextHistory = true;
  await history.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => Boolean(backend.releaseHistory)).toBe(true);
  await expect(oldestLoaded).toBeVisible();
  const anchorTop = (await oldestLoaded.boundingBox())!.y;
  backend.releaseHistory!();
  await expect.poll(() => backend.historyRequests).toBe(2);
  await expect
    .poll(async () => (await oldestLoaded.boundingBox())?.y)
    .toBeCloseTo(anchorTop, 0);
  const latest = page.getByRole('button', { name: 'Jump to latest' });
  await expect(latest).toBeVisible();
  await expect(latest).toHaveCSS('box-shadow', 'none');
  expect(await latest.locator('svg').count()).toBe(1);
  const latestBounds = (await latest.boundingBox())!;
  expect(latestBounds.width).toBe(32);
  expect(latestBounds.height).toBe(32);
  await latest.click();
  await expect(latest).toBeHidden();
  const composer = page.getByRole('textbox', { name: 'Message pal' });
  await composer.fill('First message');
  await composer.press('Shift+Enter');
  await composer.press('x');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect(page.locator('.activity-bubble')).toHaveAccessibleName('…');
  await composer.fill('Follow-up during work');
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeEnabled();
  await composer.press('Enter');
  await expect.poll(() => backend.submissions.length).toBe(2);
  expect(backend.submissions[0]!.text).toBe('First message\nx');
  expect(backend.submissions[0]!.attachmentIds).toEqual([]);
  expect(backend.submissions[0]!.destinationId).toBe('web');
  expect(backend.submissions[0]!.metadata.timezone).toBe(
    await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  expect(backend.submissions[1]!.idempotencyKey).not.toBe(
    backend.submissions[0]!.idempotencyKey,
  );
  backend.publish(backend.message('One response to both messages.'));
  backend.working = false;
  backend.emit('agent.activity', {
    event: 'agent.activity',
    state: { status: 'idle' },
  });
  await expect(
    page.getByText('One response to both messages.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.activity-bubble')).toHaveCount(0);
  await history.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => backend.historyRequests).toBe(3);
  await history.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByText('Message 1', { exact: true })).toBeVisible();
  expect(await articles.count()).toBeLessThan(63);
  await page.screenshot({ path: 'test-results/playground-desktop.png' });

  // Simulate an abrupt backend disconnect, including events lost on an older page.
  for (const stream of backend.streams) stream.destroy();
  backend.streams.clear();
  backend.rows[29] = {
    ...backend.rows[29]!,
    version: 2,
    text: 'Changed during outage',
  };
  backend.rows[39] = {
    ...backend.rows[39]!,
    version: 2,
    taskId: 'task-1',
    phase: 'commentary',
    mainVisible: false,
  };
  backend.rows.push(backend.message('Reply while disconnected'));
  backend.holdNextHistory = true;
  await expect(page.locator('#connection')).toHaveText('Reconnecting…');
  await expect.poll(() => Boolean(backend.releaseHistory)).toBe(true);
  backend.releaseHistory!();
  await expect(page.locator('#connection')).toHaveText('Connected');
  await history.evaluate((node) => {
    node.scrollTop = 0;
  });
  const changed = page.getByText('Changed during outage', { exact: true });
  await expect
    .poll(async () => {
      if (await changed.count()) return true;
      await history.evaluate((node) => {
        node.scrollTop += node.clientHeight * 0.75;
      });
      return false;
    })
    .toBe(true);
  await expect(changed).toBeVisible();
  await expect(page.getByText('Message 40', { exact: true })).toHaveCount(0);
  await latest.click();
  await expect(
    page.getByText('Reply while disconnected', { exact: true }),
  ).toHaveCount(1);
  const mountedIds = await articles.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-message-id')),
  );
  expect(new Set(mountedIds).size).toBe(mountedIds.length);
  expect(mountedIds.length).toBeLessThan(63);
  await page.reload();
  await expect(
    page.getByText('Reply while disconnected', { exact: true }),
  ).toBeVisible();
  expect(await articles.count()).toBeLessThan(30);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(composer).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/playground-mobile.png' });
  expect(browserErrors).toEqual([]);
});

test('preserves chat anchors when the keyboard resizes the viewport', async ({
  page,
}) => {
  const viewport = { width: 402, height: 874 };
  await page.setViewportSize(viewport);
  await page.addInitScript(({ height, width }) => {
    const visualViewport = new EventTarget();
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: height },
      offsetLeft: { configurable: true, value: 0 },
      offsetTop: { configurable: true, value: 0 },
      pageLeft: { configurable: true, value: 0 },
      pageTop: { configurable: true, value: 0 },
      scale: { configurable: true, value: 1 },
      width: { configurable: true, value: width },
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    });
  }, viewport);
  for (let index = 1; index <= 40; index += 1)
    backend.rows.push(
      backend.message(`Conversation message ${index} with realistic detail.`),
    );

  await page.goto('/');
  await expect(
    page.getByText('Conversation message 40 with realistic detail.', {
      exact: true,
    }),
  ).toBeVisible();
  const history = page.locator('#history');
  const latest = page.getByRole('button', { name: 'Jump to latest' });
  const remaining = () =>
    history.evaluate(
      (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
    );
  const messageComposerGap = () =>
    page.evaluate(() => {
      const messages = document.querySelectorAll('article.message');
      const latestMessage = messages.item(messages.length - 1);
      const composer = document.querySelector('#composer');
      if (!latestMessage || !composer) throw new Error('Chat is not ready.');
      return (
        composer.getBoundingClientRect().top -
        latestMessage.getBoundingClientRect().bottom
      );
    });
  await expect.poll(remaining).toBeLessThan(2);
  await expect(latest).toBeHidden();
  const restingGap = await messageComposerGap();

  const composer = page.getByRole('textbox', { name: 'Message pal' });
  await composer.focus();
  await page.evaluate(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 500,
    });
    Object.defineProperties(window.visualViewport, {
      height: { configurable: true, value: 500 },
      offsetTop: { configurable: true, value: 24 },
    });
    window.visualViewport?.dispatchEvent(new Event('resize'));
  });

  await expect(page.locator('html')).toHaveAttribute('data-keyboard-open', '');
  await expect.poll(remaining).toBeLessThan(2);
  await expect.poll(messageComposerGap).toBeCloseTo(restingGap, 0);
  await expect(latest).toBeHidden();
  await expect(composer).toBeFocused();

  await page.locator('.footer').evaluate((node: HTMLElement) => {
    node.style.paddingBottom = '36px';
  });
  await expect.poll(remaining).toBeLessThan(2);
  await expect.poll(messageComposerGap).toBeCloseTo(restingGap, 0);
  await page.locator('.footer').evaluate((node: HTMLElement) => {
    node.style.removeProperty('padding-bottom');
  });
  await expect.poll(remaining).toBeLessThan(2);
  await expect.poll(messageComposerGap).toBeCloseTo(restingGap, 0);

  await page.evaluate(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 874,
    });
    Object.defineProperties(window.visualViewport, {
      height: { configurable: true, value: 874 },
      offsetTop: { configurable: true, value: 0 },
    });
    window.visualViewport?.dispatchEvent(new Event('resize'));
  });

  await expect(page.locator('html')).not.toHaveAttribute('data-keyboard-open');
  await expect.poll(remaining).toBeLessThan(2);
  await expect(latest).toBeHidden();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  await expect
    .poll(async () => {
      await history.evaluate((node) => {
        node.scrollTop = node.scrollHeight - node.clientHeight - 300;
        node.dispatchEvent(new Event('scroll'));
      });
      return latest.isVisible();
    })
    .toBe(true);
  const readingAnchor = await history.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const composer = document.querySelector<HTMLElement>('.footer');
    if (!composer) throw new Error('Composer is not ready.');
    const composerTop = composer.getBoundingClientRect().top;
    const message = Array.from(
      node.querySelectorAll<HTMLElement>('article.message[data-message-id]'),
    )
      .filter((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < composerTop;
      })
      .at(-1);
    if (!message?.dataset.messageId)
      throw new Error('No visible message anchor.');
    return {
      id: message.dataset.messageId,
      offset: composerTop - message.getBoundingClientRect().bottom,
    };
  });
  await page.evaluate(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 500,
    });
    Object.defineProperties(window.visualViewport, {
      height: { configurable: true, value: 500 },
      offsetTop: { configurable: true, value: 24 },
    });
    window.visualViewport?.dispatchEvent(new Event('resize'));
    const history = document.querySelector<HTMLElement>('#history')!;
    history.scrollTop += 60;
    history.dispatchEvent(new Event('scroll'));
  });

  await expect(page.locator('html')).toHaveAttribute('data-keyboard-open', '');
  await expect
    .poll(() =>
      page.evaluate(({ id }) => {
        const history = document.querySelector('#history')!;
        const message = Array.from(
          history.querySelectorAll<HTMLElement>(
            'article.message[data-message-id]',
          ),
        ).find((candidate) => candidate.dataset.messageId === id);
        if (!message) throw new Error('Message anchor was unmounted.');
        const composer = document.querySelector<HTMLElement>('.footer');
        if (!composer) throw new Error('Composer is not ready.');
        return (
          composer.getBoundingClientRect().top -
          message.getBoundingClientRect().bottom
        );
      }, readingAnchor),
    )
    .toBeCloseTo(readingAnchor.offset, 0);
  await expect(latest).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 874,
    });
    Object.defineProperties(window.visualViewport, {
      height: { configurable: true, value: 874 },
      offsetTop: { configurable: true, value: 0 },
    });
    window.visualViewport?.dispatchEvent(new Event('resize'));
  });

  await expect(page.locator('html')).not.toHaveAttribute('data-keyboard-open');
  await expect
    .poll(() =>
      page.evaluate(({ id }) => {
        const message = Array.from(
          document.querySelectorAll<HTMLElement>(
            'article.message[data-message-id]',
          ),
        ).find((candidate) => candidate.dataset.messageId === id);
        const composer = document.querySelector<HTMLElement>('.footer');
        if (!message || !composer) throw new Error('Chat is not ready.');
        return (
          composer.getBoundingClientRect().top -
          message.getBoundingClientRect().bottom
        );
      }, readingAnchor),
    )
    .toBeCloseTo(readingAnchor.offset, 0);
  await expect(latest).toBeVisible();
});

test('paces Read after persistence and restores receipts from snapshots', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    document.addEventListener('transitionrun', (event) => {
      if (
        event instanceof TransitionEvent &&
        event.propertyName === 'margin-bottom' &&
        event.target instanceof Element &&
        event.target.matches('.message.user') &&
        event.target.closest('[data-optimistic-row="true"]')
      )
        document.documentElement.dataset.receiptLayoutShifted = 'true';
    });
  });
  backend.rows.push(backend.message('Earlier message', 'user'));
  backend.rows.push(backend.message('Earlier answer'));
  await page.goto('/');
  const users = page.locator('article.user');
  await expect(users.first().locator('.message-read')).toHaveAttribute(
    'data-status',
    'read',
  );
  await expect(page.locator('article.assistant .message-read')).toHaveCount(0);
  backend.holdNextSend = true;
  await page
    .getByRole('textbox', { name: 'Message pal' })
    .fill('Read this promptly');
  // The transparent padding around the visible send circle remains tappable.
  await page.getByRole('button', { name: 'Send message', exact: true }).click({
    position: { x: 1, y: 18 },
  });
  try {
    await expect.poll(() => Boolean(backend.releasePersistence)).toBe(true);
    await expect(users).toHaveCount(2);
    await expect(users.last()).toContainText('Read this promptly');
    await expect(page.locator('.message-read')).toHaveCount(0);
    await expect(users.last().locator('.reply-action')).toBeDisabled();
    const pendingRow = users.last().locator('..').locator('..');
    await pendingRow.evaluate((node) => {
      node.dataset.optimisticRow = 'true';
    });
    const pendingHeight = (await pendingRow.boundingBox())!.height;
    await page.locator('html').evaluate((node) => {
      delete node.dataset.receiptLayoutShifted;
    });
    backend.releasePersistence!();
    await expect.poll(() => Boolean(backend.releaseAcceptance)).toBe(true);
    const receipt = users.last().locator('.message-read');
    await expect(receipt).toHaveAttribute('data-status', 'delivered');
    await expect(receipt).toHaveAttribute('aria-label', 'Delivered');
    await expect(receipt).toHaveAttribute('data-visible', 'true');
    await expect(receipt).toHaveCSS('opacity', '1');
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-receipt-layout-shifted',
    );
    expect(
      await receipt.evaluate(
        (node) => getComputedStyle(node).transitionDuration !== '0s',
      ),
    ).toBe(true);
    await expect(pendingRow).toHaveAttribute('data-optimistic-row', 'true');
    expect((await pendingRow.boundingBox())!.height).toBeCloseTo(
      pendingHeight,
      0,
    );
    await expect(receipt).toHaveAttribute('data-status', 'read');
    await expect(receipt).toHaveAttribute('aria-label', /^Read /);
    await expect(receipt.locator('.message-receipt-label').first()).toHaveCSS(
      'opacity',
      '0',
    );
    await expect(receipt.locator('.message-receipt-label').last()).toHaveCSS(
      'opacity',
      '1',
    );
    await expect(users).toHaveCount(2);
    // The POST remains blocked on agent acceptance while SSE has marked Read.
    await expect(
      page.getByRole('button', { name: 'Send message', exact: true }),
    ).toBeDisabled();
    backend.releaseAcceptance!();
    await expect(
      page.getByRole('textbox', { name: 'Message pal' }),
    ).toHaveValue('');
    // Lose an SSE publication and reconcile the optimistic bubble by snapshot.
    backend.holdNextSend = true;
    backend.releasePersistence = undefined;
    backend.releaseAcceptance = undefined;
    await page.getByRole('textbox', { name: 'Message pal' }).fill('hi');
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect.poll(() => Boolean(backend.releasePersistence)).toBe(true);
    for (const stream of backend.streams) stream.end();
    backend.streams.clear();
    backend.releasePersistence!();
    await expect.poll(() => Boolean(backend.releaseAcceptance)).toBe(true);
    await expect(users).toHaveCount(3);
    await expect(users.last().locator('.message-read')).toHaveAttribute(
      'data-status',
      'read',
    );
    backend.releaseAcceptance!();
    await expect(
      page.getByRole('textbox', { name: 'Message pal' }),
    ).toHaveValue('');
    await page.reload();
    await expect(users).toHaveCount(3);
    await expect(page.locator('article.user .message-read')).toHaveCount(1);
    await expect(users.last().locator('.message-read time')).toHaveAttribute(
      'datetime',
      backend.rows.at(-1)!.createdAt,
    );
    await expect(page.locator('.message-meta')).toHaveCount(0);
    const bubble = users.last().locator('.message-bubble');
    const restoredReceipt = users.last().locator('.message-read');
    const replyIndicator = users
      .last()
      .locator('..')
      .locator('.swipe-reply-indicator');
    expect((await bubble.boundingBox())!.width).toBeLessThan(
      (await restoredReceipt.boundingBox())!.width,
    );
    const bubbleBounds = (await bubble.boundingBox())!;
    const indicatorBounds = (await replyIndicator.boundingBox())!;
    expect(indicatorBounds.height).toBeLessThanOrEqual(bubbleBounds.height);
    expect(
      Math.abs(
        bubbleBounds.y +
          bubbleBounds.height / 2 -
          (indicatorBounds.y + indicatorBounds.height / 2),
      ),
    ).toBeLessThan(1);
    await page.screenshot({ path: 'test-results/message-read.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(users.last().locator('.message-read')).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: 'test-results/message-read-mobile.png' });
  } finally {
    backend.releasePersistence?.();
    backend.releaseAcceptance?.();
  }
});

test('keeps one pacing timeline across rapid user messages', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto('/');

  const composer = page.getByRole('textbox', { name: 'Message pal' });
  const users = page.locator('article.user');
  await composer.fill('First thought');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');

  await page.waitForTimeout(700);
  await composer.fill('And one more thing');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect(users).toHaveCount(2);

  const latestReceipt = users.last().locator('.message-read');
  await expect(latestReceipt).toHaveAttribute('data-status', 'read', {
    timeout: 700,
  });
  await expect(users.first().locator('.message-read')).toHaveCount(0);
  await expect(page.locator('article.user .message-read')).toHaveCount(1);

  const typing = page.getByText('pal is typing', { exact: true });
  await expect(typing).toBeVisible({ timeout: 2_000 });
  const reply = backend.message('Got both messages.');
  backend.publish(reply);
  await expect(typing).toBeHidden();
  await expect(latestReceipt).toHaveAttribute('data-status', 'read');
});

test('reveals Read no later than typing or an early assistant', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const samples = [0.999_999, 0, 0, 0];
    Math.random = () => samples.shift() ?? 0;
  });
  await page.goto('/');

  const composer = page.getByRole('textbox', { name: 'Message pal' });
  const users = page.locator('article.user');
  const typing = page.getByText('pal is typing', { exact: true });
  await composer.fill('Take a moment');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect(users.last().locator('.message-read')).toHaveAttribute(
    'data-status',
    'delivered',
  );

  await expect(typing).toBeVisible({ timeout: 3_000 });
  await expect(users.last().locator('.message-read')).toHaveAttribute(
    'data-status',
    'read',
  );

  backend.publish(backend.message('First answer'));
  await expect(typing).toBeHidden();
  await composer.fill('Answer this quickly');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  backend.publish(backend.message('Quick answer'));

  await expect(page.locator('article.assistant')).toHaveCount(2);
  await expect(users.last().locator('.message-read')).toHaveAttribute(
    'data-status',
    'read',
  );
  await expect(typing).toBeHidden();
});

test('composes replies and navigates to quoted messages in older history', async ({
  page,
}) => {
  for (let i = 1; i <= 65; i++)
    backend.rows.push(backend.message(`Prior ${i}`));
  const target = backend.rows[1]!;
  const recent = backend.rows.at(-1)!;
  await page.goto('/');
  const recentArticle = page.locator(`[data-message-id="${recent.id}"]`);
  await recentArticle
    .getByRole('button', { name: 'Reply to pal’s message' })
    .click();
  await expect(page.locator('#composer-reply')).toContainText('Prior 65');
  await page.getByRole('button', { name: 'Cancel reply' }).click();
  await expect(page.locator('#composer-reply')).toBeHidden();
  await expect(
    page.getByRole('textbox', { name: 'Message pal' }),
  ).toBeFocused();
  await recentArticle
    .getByRole('button', { name: 'Reply to pal’s message' })
    .click();
  const draft = page.getByRole('textbox', { name: 'Message pal' });
  await draft.fill('About the recent one');
  backend.failNextSend = true;
  await draft.press('Enter');
  await expect(page.locator('#send-error')).toBeVisible();
  await expect(page.locator('#composer-reply')).toContainText('Prior 65');
  await draft.press('Enter');
  await expect.poll(() => backend.submissions.length).toBe(2);
  await expect
    .poll(() => backend.submissions.at(-1)?.replyToMessageId)
    .toBe(recent.id);
  const saved = backend.rows.at(-1)!;
  await expect(
    page.locator(`[data-message-id="${saved.id}"] .message-quote`),
  ).toContainText('Prior 65');
  await page.screenshot({ path: 'test-results/playground-reply.png' });
  await expect(page.locator('#composer-reply')).toBeHidden();
  await page.reload();
  await expect(
    page.locator(`[data-message-id="${saved.id}"] .message-quote`),
  ).toBeVisible();
  const delayed = {
    ...backend.message('A later answer to an older message'),
    replyToMessageId: target.id,
    replyTo: {
      id: target.id,
      sequence: target.sequence,
      role: target.role,
      textPreview: target.text,
      taskId: target.taskId,
      phase: target.phase,
      mainVisible: false,
    },
  } satisfies Message;
  backend.publish(delayed);
  await page
    .locator(`[data-message-id="${delayed.id}"]`)
    .getByRole('button', { name: 'View quoted message' })
    .click();
  await expect(page.locator(`[data-message-id="${target.id}"]`)).toHaveClass(
    /quote-highlight/,
  );
  const absent = {
    ...backend.message('Answer quoting another client'),
    replyToMessageId: 'not-in-this-client',
    replyTo: {
      id: 'not-in-this-client',
      sequence: 1,
      role: 'user' as const,
      textPreview: 'Sent from another client',
      taskId: null,
      phase: null,
      mainVisible: false,
    },
  } satisfies Message;
  backend.publish(absent);
  const absentArticle = page.locator(`[data-message-id="${absent.id}"]`);
  await expect(
    page.getByRole('button', { name: 'Jump to latest' }),
  ).toBeVisible();
  await expect(absentArticle).toHaveCount(0);
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await expect(absentArticle).toContainText('Sent from another client');
  await absentArticle
    .getByRole('button', { name: 'View quoted message' })
    .click();
  await expect(absentArticle).toBeVisible();
});

test('preserves historical Main visibility without exposing task-only quotes', async ({
  page,
}) => {
  backend.taskRows.push({
    id: 'quote-task',
    title: 'Quote task',
    goal: 'Check reply visibility',
    description: '',
    status: 'in-progress',
    archived: false,
    version: 1,
    createdAt: '2026-10-06T08:00:00.000Z',
    updatedAt: '2026-10-06T08:00:00.000Z',
    lastActivityAt: '2026-10-06T08:00:00.000Z',
  });
  const taskOnly: Message = {
    ...backend.message('Task-only detail'),
    taskId: 'quote-task',
    phase: 'commentary',
    mainVisible: false,
  };
  backend.rows.push(taskOnly);
  const final: Message = {
    ...backend.message('Shared conclusion'),
    taskId: 'quote-task',
    phase: 'final_answer',
    mainVisible: true,
    replyToMessageId: taskOnly.id,
    replyTo: {
      id: taskOnly.id,
      sequence: taskOnly.sequence,
      role: taskOnly.role,
      textPreview: taskOnly.text,
      taskId: taskOnly.taskId,
      phase: taskOnly.phase,
      mainVisible: false,
    },
  };
  backend.rows.push(final);
  await page.goto('/');
  await expect(page.locator(`[data-message-id="${final.id}"]`)).toBeVisible();
  await expect(
    page.locator(`[data-message-id="${final.id}"] .message-quote`),
  ).toHaveCount(0);
  await page.locator('#thread-open').click();
  await page.locator('[data-task-id="quote-task"]').click();
  await expect(
    page.locator(`[data-message-id="${final.id}"] .message-quote`),
  ).toContainText('Task-only detail');
  await page
    .locator(`[data-message-id="${taskOnly.id}"]`)
    .getByRole('button', { name: 'Reply to pal’s message' })
    .click();
  await page
    .getByRole('textbox', { name: 'Message pal' })
    .fill('Please expand');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect
    .poll(() => backend.submissions.at(-1)?.replyToMessageId)
    .toBe(taskOnly.id);
  expect(backend.submissions.at(-1)?.taskId).toBe('quote-task');
});

test('keeps single-line bubble gaps consistent across pointer types and widths', async ({
  browser,
  baseURL,
}) => {
  for (const role of [
    'user',
    'user',
    'assistant',
    'assistant',
    'user',
    'assistant',
  ] as const)
    backend.rows.push(backend.message('hello', role));
  for (const viewport of [
    { width: 1280, hasTouch: false },
    { width: 390, hasTouch: true },
    { width: 820, hasTouch: true },
  ]) {
    const context = await browser.newContext({
      hasTouch: viewport.hasTouch,
      viewport: { width: viewport.width, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    try {
      await page.goto(baseURL!);
      const bubbles = page.locator('article.message .message-bubble');
      await expect(bubbles).toHaveCount(6);
      for (const index of [1, 2, 3]) {
        await expect
          .poll(async () => {
            const before = (await bubbles.nth(index - 1).boundingBox())!;
            const after = (await bubbles.nth(index).boundingBox())!;
            return after.y - before.y - before.height;
          })
          .toBeCloseTo(8, 0);
      }
      const reply = (await page
        .locator('.reply-action')
        .first()
        .boundingBox())!;
      expect(reply.width).toBe(32);
      expect(reply.height).toBe(32);
    } finally {
      await context.close();
    }
  }
});

test('keeps the composer focused when touch jumps to the latest message', async ({
  browser,
}) => {
  for (let index = 1; index <= 40; index += 1)
    backend.rows.push(backend.message(`Touch jump message ${index}`));
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/');

  const history = page.locator('#history');
  const latest = page.getByRole('button', { name: 'Jump to latest' });
  await expect(
    page.getByText('Touch jump message 40', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      await history.evaluate((node) => {
        node.scrollTop = Math.max(
          0,
          node.scrollHeight - node.clientHeight - 300,
        );
        node.dispatchEvent(new Event('scroll'));
      });
      return latest.count();
    })
    .toBe(1);
  const composer = page.getByRole('textbox', { name: 'Message pal' });
  await composer.focus();
  await page
    .locator('html')
    .evaluate((node) => node.setAttribute('data-keyboard-open', ''));

  const mouseDownWasCancelled = page.evaluate(() => {
    return new Promise<boolean>((resolve) => {
      document.addEventListener(
        'mousedown',
        (event) => resolve(event.defaultPrevented),
        { once: true },
      );
    });
  });

  await latest.tap();

  expect(await mouseDownWasCancelled).toBe(true);
  await expect(latest).toBeHidden();
  await expect(composer).toBeFocused();
  await expect
    .poll(() =>
      history.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
      ),
    )
    .toBeLessThan(2);
  await context.close();
});

test('keeps touch sends focused and preserves later keyboard navigation', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await expect(page.locator('#connection')).toHaveText('Connected');
    const composer = page.getByRole('textbox', { name: 'Message pal' });
    const send = page.getByRole('button', {
      name: 'Send message',
      exact: true,
    });
    const previousReply = page
      .getByRole('button', { name: 'Reply to your message', exact: true })
      .first();
    await composer.evaluate((node) => {
      node.addEventListener('blur', () => {
        node.setAttribute('data-blurred', 'true');
      });
    });
    for (const moveAway of [false, true]) {
      await composer.fill(moveAway ? 'Keep my next focus' : 'Keep typing');
      await composer.evaluate((node) => node.removeAttribute('data-blurred'));
      backend.holdNextSend = true;
      await send.tap();
      await expect.poll(() => Boolean(backend.releasePersistence)).toBe(true);
      await expect(composer).toBeFocused();
      await expect(composer).not.toHaveAttribute('data-blurred');
      if (moveAway) {
        await composer.press('Shift+Tab');
        await expect(previousReply).toBeFocused();
      }
      backend.releasePersistence!();
      await expect.poll(() => Boolean(backend.releaseAcceptance)).toBe(true);
      backend.releaseAcceptance!();
      await expect(composer).toHaveValue('');
      await expect(moveAway ? previousReply : composer).toBeFocused();
      if (!moveAway) await expect(composer).not.toHaveAttribute('data-blurred');
      backend.releasePersistence = undefined;
      backend.releaseAcceptance = undefined;
    }
    await composer.fill('Send with Enter');
    await composer.press('Enter');
    await expect(composer).toHaveValue('');
    await expect(composer).toBeFocused();
    expect(backend.submissions).toHaveLength(3);
  } finally {
    backend.releasePersistence?.();
    backend.releaseAcceptance?.();
    await context.close();
  }
});

test('shows an ephemeral typing bubble after an accepted message', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes,
      options?: number | KeyframeAnimationOptions,
    ) {
      const frames = Array.isArray(keyframes) ? keyframes : [];
      const content = this as HTMLElement;
      const key = content.parentElement?.dataset.chatLayoutKey;
      if (key && frames.some((frame) => frame.opacity !== undefined)) {
        const root = document.documentElement;
        root.dataset.layoutEntrances = [root.dataset.layoutEntrances, key]
          .filter(Boolean)
          .join(',');
        if (frames.some((frame) => frame.transform !== undefined))
          root.dataset.layoutEntranceMoved = 'true';
      }
      if (key && frames.some((frame) => frame.transform !== undefined))
        document.documentElement.dataset.layoutShifted = 'true';
      return animate.call(this, keyframes, options);
    };
  });
  for (let index = 1; index <= 24; index += 1)
    backend.rows.push(backend.message(`Typing message ${index}`));
  await page.goto('/');

  const history = page.locator('#history');
  const composer = page.getByRole('textbox', { name: 'Message pal' });
  const typing = page.getByText('pal is typing', { exact: true });
  await composer.fill('Are you there?');
  await composer.press('Enter');

  await expect(typing).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute(
    'data-layout-entrances',
    /message:/,
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-layout-entrances',
    /typing/,
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-layout-shifted',
    'true',
  );
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-layout-entrance-moved',
    'true',
  );
  await expect(page.locator('.typing-dot')).toHaveCount(3);
  await expect(
    page.locator(
      '.typing-layout-row > .message.assistant > .message-bubble > .typing-indicator',
    ),
  ).toBeVisible();
  await expect(page.locator('.typing-dot').first()).toHaveCSS(
    'animation-name',
    'typing-dot',
  );
  await expect(
    page.getByRole('button', { name: 'Jump to latest' }),
  ).toBeHidden();
  await expect
    .poll(() =>
      history.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
      ),
    )
    .toBeLessThan(2);

  const earlier = backend.rows[0]!;
  backend.publish({ ...earlier, version: earlier.version + 1 });
  await expect(typing).toBeVisible();

  const reply = backend.message('I am here.');
  backend.publish(reply);
  await expect(typing).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute(
    'data-layout-entrances',
    new RegExp(`message:${reply.id}`),
  );

  await composer.fill('One more thing');
  await composer.press('Enter');
  await expect(typing).toBeVisible();
  await expect(typing).toBeHidden({ timeout: 3_000 });

  backend.failNextSend = true;
  await composer.fill('This one fails');
  await composer.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Could not send.');
  await expect(typing).toBeHidden();
});

test('smoothly reveals the exact conversation bottom after a send', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 1;
    const scrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
      y?: number,
    ) {
      if (this.id === 'history') {
        if (typeof options === 'object') {
          this.dataset.scrollBehaviors = [
            this.dataset.scrollBehaviors,
            options.behavior ?? 'auto',
          ]
            .filter(Boolean)
            .join(',');
        }
      }
      Reflect.apply(
        scrollTo,
        this,
        typeof options === 'number' ? [options, y ?? 0] : [options],
      );
    } as typeof HTMLElement.prototype.scrollTo;
  });
  for (let index = 1; index <= 40; index += 1)
    backend.rows.push(backend.message(`Send scroll message ${index}`));
  await page.goto('/');

  const history = page.locator('#history');
  const latest = page.getByRole('button', { name: 'Jump to latest' });
  await expect(
    page.getByText('Send scroll message 40', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      await history.evaluate((node) => {
        node.scrollTop = 0;
        node.dispatchEvent(new Event('scroll'));
      });
      return latest.count();
    })
    .toBe(1);

  const composer = page.getByRole('textbox', { name: 'Message pal' });
  await composer.fill('Take me to this message');
  await composer.press('Enter');

  await expect(history).toHaveAttribute('data-scroll-behaviors', /smooth/);
  await expect
    .poll(() =>
      history.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
      ),
    )
    .toBeLessThan(2);
  await expect(latest).toBeHidden();
});

test('swipes a persisted message to reply with a touch pointer', async ({
  browser,
}) => {
  const target = { ...backend.message('Swipe reply target'), reaction: '👀' };
  backend.rows.push(target);
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await page.goto('/');

  const message = page.locator(`[data-message-id="${target.id}"]`);
  const row = message.locator('..');
  const indicator = row.locator('.swipe-reply-indicator');
  const replyAction = message.getByRole('button', {
    name: 'Reply to pal’s message',
  });
  const replyBounds = (await replyAction.boundingBox())!;
  await page.touchscreen.tap(
    replyBounds.x + replyBounds.width / 2,
    replyBounds.y + replyBounds.height / 2,
  );
  await expect(page.locator('#composer-reply')).toBeHidden();

  const bounds = (await row.boundingBox())!;
  const start = {
    x: bounds.x + bounds.width - 24,
    y: bounds.y + bounds.height / 2,
  };

  async function swipe(distance: number, hold = false) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [start],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x - distance, y: start.y }],
    });
    if (hold) return;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  }

  await swipe(32);
  await expect(page.locator('#composer-reply')).toBeHidden();

  await swipe(64, true);
  await expect(row).toHaveAttribute('data-reply-swipe', 'armed');
  const bubble = (await message.locator('.message-bubble').boundingBox())!;
  const indicatorBox = (await indicator.boundingBox())!;
  expect(indicatorBox.y + indicatorBox.height / 2).toBeCloseTo(
    bubble.y + bubble.height / 2,
    1,
  );
  expect(
    await indicator.evaluate((node) => getComputedStyle(node).opacity),
  ).toBe('1');
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect(page.locator('#composer-reply')).toContainText(
    'Swipe reply target',
  );
  await page.getByRole('button', { name: 'Cancel reply' }).tap();
  await expect(page.locator('#composer-reply')).toBeHidden();
  await expect(
    page.getByRole('textbox', { name: 'Message pal' }),
  ).not.toBeFocused();

  await context.close();
});

test('preserves a failed submission and resends only on explicit input with a fresh key', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#connection')).toHaveText('Connected');
  const composer = page.getByRole('textbox', { name: 'Message pal' });
  const button = page.getByRole('button', {
    name: 'Send message',
    exact: true,
  });
  await composer.fill('Keep this draft');
  await expect(button).toBeEnabled();
  backend.failNextSend = true;
  await button.click();
  await expect(page.locator('#send-error')).toContainText(
    'Your message may already be saved',
  );
  await expect(composer).toHaveValue('Keep this draft');
  await expect(composer).toBeFocused();
  await expect(page.locator('article.user')).toHaveCount(1);
  await expect(page.locator('article.user .message-read')).toHaveAttribute(
    'data-status',
    'read',
  );
  await expect(button).toBeEnabled();
  expect(backend.submissions).toHaveLength(1);
  await button.click();
  await expect(composer).toHaveValue('');
  await expect(composer).toBeFocused();
  await expect(page.locator('article.user')).toHaveCount(2);
  expect(backend.submissions).toHaveLength(2);
  expect(backend.submissions[1]!.idempotencyKey).not.toBe(
    backend.submissions[0]!.idempotencyKey,
  );
  await expect(page.locator('#send-error')).toBeHidden();
});

test('shows one attached agent reaction and restores its replacement after reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
  });
  const target = backend.message('Can you check my emails?', 'user');
  backend.rows.push(target);
  await page.goto('/');
  await expect(page.getByText(target.text, { exact: true })).toBeVisible();
  backend.publish({ ...target, version: 2, reaction: '👀' });
  const reaction = page.getByRole('img', { name: 'pal reacted 👀' });
  await expect(reaction).toBeVisible();
  const opacity = await reaction.evaluate((node) => {
    const animation = node.getAnimations()[0]!;
    animation.pause();
    animation.currentTime = 0;
    const start = Number(getComputedStyle(node).opacity);
    animation.currentTime =
      Number(animation.effect!.getComputedTiming().duration) / 2;
    const middle = Number(getComputedStyle(node).opacity);
    animation.finish();
    return { start, middle, end: Number(getComputedStyle(node).opacity) };
  });
  expect(opacity.start).toBeLessThan(opacity.middle);
  expect(opacity.middle).toBeLessThan(opacity.end);
  expect(opacity.end).toBe(1);
  await page
    .locator('article.message')
    .evaluate((node) =>
      Promise.all(node.getAnimations().map((animation) => animation.finished)),
    );
  const bubbleBox = (await page.locator('.message-bubble').boundingBox())!;
  const reactionBox = (await reaction.boundingBox())!;
  expect(reactionBox.width).toBe(reactionBox.height);
  expect(reactionBox.x + reactionBox.width / 2).toBeCloseTo(bubbleBox.x, 1);
  expect(reactionBox.y).toBeLessThan(bubbleBox.y);
  expect(reactionBox.y + reactionBox.height / 2).toBeCloseTo(bubbleBox.y, 1);
  const textBox = (await page
    .getByText(target.text, { exact: true })
    .boundingBox())!;
  const emojiBottom = await reaction.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().bottom;
  });
  expect(emojiBottom).toBeLessThan(textBox.y);
  await page.screenshot({ path: 'test-results/reaction-mobile.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  backend.publish({ ...target, version: 3, reaction: '👍🏽' });
  const replacement = page.getByRole('img', { name: 'pal reacted 👍🏽' });
  await expect(replacement).toBeVisible();
  const replacementBox = (await replacement.boundingBox())!;
  expect(replacementBox.width).toBe(replacementBox.height);
  expect(replacementBox.width).toBe(reactionBox.width);
  expect(
    await replacement.evaluate((node) => node.getAnimations().length),
  ).toBe(0);
  await expect(page.getByRole('img', { name: 'pal reacted 👀' })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByRole('img', { name: 'pal reacted 👍🏽' })).toBeVisible();
  await expect(page.locator('article.message')).toHaveCount(1);

  const assistant = {
    ...backend.message('Your emails are checked.'),
    reaction: '👍',
  };
  backend.publish(assistant);
  const assistantRow = page.locator(
    `article[data-message-id="${assistant.id}"]`,
  );
  await expect(assistantRow.locator('.message-reaction')).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [message, edge] of [
      [target, 'left'],
      [assistant, 'right'],
    ] as const) {
      const row = page.locator(`article[data-message-id="${message.id}"]`);
      await expect(row.locator('.message-reaction')).toBeVisible();
      const bubble = (await row.locator('.message-bubble').boundingBox())!;
      const circle = (await row.locator('.message-reaction').boundingBox())!;
      expect(circle.x + circle.width / 2).toBeCloseTo(
        edge === 'left' ? bubble.x : bubble.x + bubble.width,
        1,
      );
      expect(circle.y + circle.height / 2).toBeCloseTo(bubble.y, 1);
      for (const control of [
        row.locator('.reply-action'),
        row.locator('..').locator('.swipe-reply-indicator'),
      ]) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.y + bounds.height / 2).toBeCloseTo(
          bubble.y + bubble.height / 2,
          1,
        );
      }
      expect(circle.x).toBeGreaterThanOrEqual(0);
      expect(circle.x + circle.width).toBeLessThanOrEqual(width);
    }
  }

  const followup = {
    ...backend.message('Thanks!', 'user'),
    reaction: '❤️',
  };
  backend.publish(followup);
  const followupRow = page.locator(`article[data-message-id="${followup.id}"]`);
  await expect(followupRow.locator('.message-reaction')).toBeVisible();
  await expect
    .poll(async () => {
      const assistantBubble = (await assistantRow
        .locator('.message-bubble')
        .boundingBox())!;
      const followupReaction = (await followupRow
        .locator('.message-reaction')
        .boundingBox())!;
      return followupReaction.y - (assistantBubble.y + assistantBubble.height);
    })
    .toBeCloseTo(8, 0);
});
