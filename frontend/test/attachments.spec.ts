import { expect, test } from '@playwright/test';
import type { Attachment, TaskDetails } from '../src/api/client';
import { backend, usePalBackend } from './support/pal-backend';

usePalBackend(test);

const attachmentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0YkAAAAASUVORK5CYII=',
  'base64',
);
const fixtureAttachment = (
  id: string,
  filename: string,
  contentType = 'image/png',
): Attachment => ({
  id,
  filename,
  contentType,
  sizeBytes: attachmentPng.length,
  createdAt: '2026-10-08T00:00:00.000Z',
});

test('uploads mixed files, renders image-count grids and uniform document pills, and restores attachments on reload', async ({
  page,
}) => {
  let uploads = 0;
  await page.route('**/api/files**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const filename = request
        .postDataBuffer()!
        .toString()
        .match(/filename="([^"]+)"/)![1];
      const attachment = fixtureAttachment(
        `uploaded-${++uploads}`,
        filename,
        filename.endsWith('.png') ? 'image/png' : 'application/pdf',
      );
      backend.uploadedFiles.set(attachment.id, attachment);
      await route.fulfill({ status: 201, json: { attachment } });
    } else {
      const download = request.url().endsWith('/download');
      await route.fulfill({
        contentType: 'image/png',
        body: attachmentPng,
        headers: download
          ? { 'Content-Disposition': 'attachment; filename="image.png"' }
          : {},
      });
    }
  });
  await page.goto('/');
  const history = page.locator('#history');
  async function reveal(locator: ReturnType<typeof page.locator>) {
    await expect
      .poll(async () => {
        if (await locator.count()) return true;
        await history.evaluate((node) => {
          node.scrollTop += node.clientHeight * 0.75;
        });
        return false;
      })
      .toBe(true);
  }
  const composer = page.getByRole('textbox', { name: 'Message pal' });
  await page.locator('#file-input').setInputFiles([
    { name: 'photo.png', mimeType: 'image/png', buffer: attachmentPng },
    {
      name: 'a-very-long-report-name-that-needs-truncation-and-stays-uniform.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('fixture PDF'),
    },
  ]);
  await expect(page.locator('#pending-files')).toContainText('Ready');
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeEnabled();
  await composer.press('Enter');
  await expect.poll(() => backend.submissions.length).toBe(1);
  expect(backend.submissions[0].text).toBe('');
  expect(backend.submissions[0].attachmentIds).toEqual([
    'uploaded-1',
    'uploaded-2',
  ]);
  await expect(page.locator('#pending-files')).toBeHidden();
  await expect(page.locator('article.user .image-grid')).toHaveAttribute(
    'data-columns',
    '1',
  );
  await expect(page.locator('article.user .file-pill')).toContainText('.pdf');
  await page
    .getByRole('button', { name: 'Open image 1 of 1: photo.png' })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Image preview' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Close image preview' }),
  ).toBeVisible();
  await expect(page.locator('.image-lightbox-counter')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Previous image' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next image' })).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('dialog')
    .getByRole('link', { name: 'Download photo.png', exact: true })
    .click();
  expect((await downloading).suggestedFilename()).toBe('image.png');
  await page.keyboard.press('Escape');
  for (const count of [1, 2, 3, 4, 5, 7]) {
    backend.publish({
      ...backend.message(`Grid with ${count} images`),
      attachments: Array.from({ length: count }, (_, index) =>
        fixtureAttachment(`grid-${count}-${index}`, `image-${index}.png`),
      ),
    });
  }
  // Preview failure remains downloadable, including keyboard opening.
  await page.route('**/api/files/broken/content', (route) =>
    route.fulfill({ status: 404, body: 'Unavailable' }),
  );
  const broken = {
    ...backend.message('Preview failure'),
    attachments: [fixtureAttachment('broken', 'broken.png')],
  };
  backend.publish(broken);
  const brokenArticle = page.locator(`[data-message-id="${broken.id}"]`);
  await brokenArticle.scrollIntoViewIfNeeded();
  await expect(brokenArticle.locator('.image-cell')).toHaveAttribute(
    'data-state',
    'failed',
  );
  await brokenArticle
    .getByRole('button', { name: 'Open image 1 of 1: broken.png' })
    .press('Enter');
  await expect(page.getByRole('dialog')).toContainText(
    'Image preview unavailable',
  );
  await expect(
    page.getByRole('dialog').getByRole('link', {
      name: 'Download broken.png',
    }),
  ).toBeVisible();
  await page.getByRole('dialog').press('Escape');
  let releasePreview!: () => void;
  const previewReady = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  await page.route('**/api/files/loading/content', async (route) => {
    await previewReady;
    await route.fulfill({ contentType: 'image/png', body: attachmentPng });
  });
  const loading = {
    ...backend.message('Loading preview'),
    attachments: [fixtureAttachment('loading', 'loading.png')],
  };
  backend.publish(loading);
  const loadingArticle = page.locator(`[data-message-id="${loading.id}"]`);
  try {
    await loadingArticle.scrollIntoViewIfNeeded();
    await expect(loadingArticle.locator('.image-cell')).toHaveAttribute(
      'data-state',
      'loading',
    );
    await expect(loadingArticle.locator('.image-status')).toHaveText(
      'Loading…',
    );
    expect(
      (await loadingArticle.locator('.image-cell').boundingBox())!.height,
    ).toBeGreaterThanOrEqual(80);
  } finally {
    releasePreview();
  }
  await expect(loadingArticle.locator('.image-cell')).toHaveAttribute(
    'data-state',
    'ready',
  );
  const documents = [
    fixtureAttachment('short', 'a.pdf', 'application/pdf'),
    fixtureAttachment(
      'long',
      'a-really-long-document-name-with-a-recognizable-extension.pdf',
      'application/pdf',
    ),
  ];
  const mixed = {
    ...backend.message('Mixed attachments'),
    attachments: [fixtureAttachment('mixed', 'mixed.png'), ...documents],
  };
  backend.publish(mixed);
  await history.evaluate((node) => {
    node.scrollTop = 0;
  });
  for (const count of [1, 2, 3, 4, 5, 7]) {
    const article = page
      .locator('article')
      .filter({ hasText: `Grid with ${count} images` });
    await reveal(article);
    await expect(article.locator('.image-grid')).toHaveAttribute(
      'data-columns',
      String(Math.min(count, 4)),
    );
    await expect(article.locator('.image-open')).toHaveCount(count);
    await article.scrollIntoViewIfNeeded();
    for (const cell of await article.locator('.image-open').all()) {
      const bounds = (await cell.boundingBox())!;
      expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
      expect(bounds.width).toBe(96);
    }
  }
  await reveal(page.locator(`[data-message-id="${mixed.id}"]`));
  const pills = page.locator(`[data-message-id="${mixed.id}"] .file-pill`);
  await expect(pills).toHaveCount(2);
  const [short, long] = await pills.evaluateAll((nodes) =>
    nodes.map((node) => ({
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
    })),
  );
  expect(short).toEqual(long);
  expect(short.height).toBe(72);
  expect(
    await pills
      .nth(1)
      .locator('.file-stem')
      .evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await pills.last().scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await history.evaluate((node) => {
    node.scrollTop = 0;
  });
  for (const count of [1, 2, 3, 4, 5, 7]) {
    const article = page
      .locator('article')
      .filter({ hasText: `Grid with ${count} images` });
    await reveal(article);
    await article.scrollIntoViewIfNeeded();
    const cells = await article.locator('.image-open').all();
    const gridBounds = (await article.locator('.image-grid').boundingBox())!;
    for (const cell of cells) {
      const bounds = (await cell.boundingBox())!;
      expect(bounds.width).toBeLessThanOrEqual(72);
      expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
      expect(bounds.x).toBeGreaterThanOrEqual(gridBounds.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        gridBounds.x + gridBounds.width + 0.5,
      );
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    }
  }
  await reveal(page.locator(`[data-message-id="${mixed.id}"]`));
  const mobilePills = await pills.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().width),
  );
  expect(mobilePills[0]).toBe(mobilePills[1]);
  await pills.last().scrollIntoViewIfNeeded();
  await page.reload();
  await history.evaluate((node) => {
    node.scrollTop = 0;
  });
  await reveal(page.locator('article.user'));
  await expect(page.locator('article.user .image-grid')).toHaveCount(1);
  await reveal(page.locator(`[data-message-id="${mixed.id}"]`));
  await expect(
    page.locator(`[data-message-id="${mixed.id}"] .file-pill`),
  ).toHaveCount(2);
});

test('opens an image-first lightbox and navigates within one message by pointer and keyboard', async ({
  page,
}) => {
  const images = ['first.png', 'second.png', 'third.png'].map(
    (filename, index) => fixtureAttachment(`gallery-${index}`, filename),
  );
  backend.rows.push({
    ...backend.message('Gallery'),
    attachments: images,
  });
  await page.route('**/api/files/gallery-*/content', (route) =>
    route.fulfill({ contentType: 'image/png', body: attachmentPng }),
  );
  await page.addInitScript(() => localStorage.setItem('pal-theme', 'dark'));
  await page.goto('/');

  const opener = page.getByRole('button', {
    name: 'Open image 2 of 3: second.png',
  });
  const replyAction = page.getByRole('button', {
    name: 'Reply to pal’s message',
  });
  await opener.focus();
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/pal-raised-backdrop/);
  expect(
    await dialog.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');
  expect(
    await dialog.evaluate((node) => getComputedStyle(node).backdropFilter),
  ).toContain('blur(8px)');
  await expect(
    page.locator('.mantine-Modal-overlay.pal-overlay-backdrop'),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Close image preview' }),
  ).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'second.png' })).toBeVisible();
  await expect(dialog.locator('.image-lightbox-counter')).toHaveText('2/3');
  await expect(
    dialog.getByRole('button', { name: 'Previous image' }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Next image' }),
  ).toBeVisible();

  await dialog.getByRole('img', { name: 'second.png' }).click();
  await expect(dialog).toBeVisible();
  const nextButton = dialog.getByRole('button', { name: 'Next image' });
  const nextBeforePress = (await nextButton.boundingBox())!;
  await nextButton.hover();
  await page.mouse.down();
  const nextWhilePressed = (await nextButton.boundingBox())!;
  expect(nextWhilePressed.y).toBeCloseTo(nextBeforePress.y, 1);
  await page.mouse.up();
  await expect(dialog.getByRole('img', { name: 'third.png' })).toBeVisible();
  await expect(dialog.locator('.image-lightbox-counter')).toHaveText('3/3');
  await expect(
    dialog.getByRole('button', { name: 'Next image' }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Previous image' }).click();
  await expect(dialog.getByRole('img', { name: 'second.png' })).toBeVisible();
  await expect(dialog.locator('.image-lightbox-counter')).toHaveText('2/3');
  await dialog.getByRole('button', { name: 'Close image preview' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.getByRole('img', { name: 'first.png' })).toBeVisible();
  await expect(dialog.locator('.image-lightbox-counter')).toHaveText('1/3');

  await dialog
    .locator('.image-lightbox-stage')
    .click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  await expect(opener).not.toBeFocused();
  await expect(replyAction).toHaveCSS('opacity', '0');

  await opener.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('uses touch swipes without showing fine-pointer gallery arrows', async ({
  browser,
}) => {
  const images = ['touch-first.png', 'touch-second.png'].map(
    (filename, index) => fixtureAttachment(`touch-gallery-${index}`, filename),
  );
  backend.rows.push({
    ...backend.message('Touch gallery'),
    attachments: images,
  });
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.route('**/api/files/touch-gallery-*/content', (route) =>
      route.fulfill({ contentType: 'image/png', body: attachmentPng }),
    );
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Open image 1 of 2: touch-first.png' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('button', { name: 'Previous image' }),
    ).toBeHidden();
    await expect(
      dialog.getByRole('button', { name: 'Next image' }),
    ).toBeHidden();
    await expect(
      dialog.getByRole('button', { name: 'Close image preview' }),
    ).toBeVisible();
    await expect(dialog.locator('.image-lightbox-counter')).toHaveText('1/2');
    const messageRow = page
      .locator('.message-swipe-row')
      .filter({ hasText: 'Touch gallery' });
    await expect(messageRow).not.toHaveAttribute('data-reply-swipe');

    const first = dialog.getByRole('img', { name: 'touch-first.png' });
    await first.dispatchEvent('pointerdown', {
      bubbles: true,
      clientX: 280,
      clientY: 400,
      pointerId: 7,
      pointerType: 'touch',
    });
    expect(await messageRow.getAttribute('data-reply-swipe')).toBeNull();
    await first.dispatchEvent('pointerup', {
      bubbles: true,
      clientX: 180,
      clientY: 405,
      pointerId: 7,
      pointerType: 'touch',
    });
    await expect(
      dialog.getByRole('img', { name: 'touch-second.png' }),
    ).toBeVisible();
    await expect(dialog.locator('.image-lightbox-counter')).toHaveText('2/2');

    const second = dialog.getByRole('img', { name: 'touch-second.png' });
    await second.dispatchEvent('pointerdown', {
      bubbles: true,
      clientX: 120,
      clientY: 400,
      pointerId: 8,
      pointerType: 'touch',
    });
    await second.dispatchEvent('pointerup', {
      bubbles: true,
      clientX: 220,
      clientY: 405,
      pointerId: 8,
      pointerType: 'touch',
    });
    await expect(
      dialog.getByRole('img', { name: 'touch-first.png' }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('preserves selected files and destination through upload retry, chat switches, and uncertain sends', async ({
  page,
}) => {
  const task: TaskDetails = {
    id: 'file-task',
    version: 1,
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
    lastActivityAt: '2026-10-08T00:00:00.000Z',
    title: 'File task',
    goal: 'Read files',
    description: '',
    status: 'in-progress',
    archived: false,
  };
  backend.taskRows = [task];
  const quoted = {
    ...backend.message('Earlier file instructions'),
    taskId: task.id,
    phase: 'commentary' as const,
  };
  backend.rows.push(quoted);
  let fail = true;
  await page.route('**/api/files', async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        json: { message: 'Upload interrupted' },
      });
      return;
    }
    const attachment = fixtureAttachment('retried', 'notes.txt', 'text/plain');
    backend.uploadedFiles.set(attachment.id, attachment);
    await route.fulfill({ status: 201, json: { attachment } });
  });
  await page.goto('/');
  await page.locator('#thread-open').click();
  await page
    .locator('#task-list')
    .getByRole('button', { name: /File task/ })
    .click();
  const composer = page.getByRole('textbox', { name: 'Message pal' });
  await page
    .locator(`[data-message-id="${quoted.id}"]`)
    .getByRole('button', { name: 'Reply to pal’s message' })
    .click();
  await composer.fill('Read these notes');
  await page.locator('#file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('notes'),
  });
  await expect(page.locator('#pending-files')).toContainText(
    'Upload interrupted',
  );
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeDisabled();
  await page.locator('#thread-open').click();
  await page.getByRole('button', { name: 'Main', exact: true }).click();
  await expect(page.locator('#pending-files')).toBeHidden();
  await page.locator('#thread-open').click();
  await page
    .locator('#task-list')
    .getByRole('button', { name: /File task/ })
    .click();
  await expect(composer).toHaveValue('Read these notes');
  await expect(page.locator('#composer-reply')).toContainText(
    'Earlier file instructions',
  );
  await expect(page.locator('#pending-files')).toContainText('notes.txt');
  await page.getByRole('button', { name: 'Retry upload notes.txt' }).click();
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeEnabled();
  backend.failNextSend = true;
  await composer.press('Enter');
  await expect(page.locator('#send-error')).toBeVisible();
  await expect(page.locator('#pending-files')).toContainText('notes.txt');
  await expect(composer).toHaveValue('Read these notes');
  expect(backend.submissions[0].taskId).toBe(task.id);
  expect(backend.submissions[0].replyToMessageId).toBe(quoted.id);
  expect(backend.submissions[0].attachmentIds).toEqual(['retried']);
  await composer.press('Enter');
  await expect(page.locator('#pending-files')).toBeHidden();
  expect(backend.submissions[1].taskId).toBe(task.id);
  expect(backend.submissions[1].attachmentIds).toEqual(['retried']);
});

test('accepts dropped and pasted files with three concurrent uploads and preserves selection order', async ({
  page,
}) => {
  const releases: Array<() => void> = [];
  let active = 0;
  let maximum = 0;
  let received = 0;
  await page.route('**/api/files', async (route) => {
    const filename = route
      .request()
      .postDataBuffer()!
      .toString()
      .match(/filename="([^"]+)"/)![1];
    received++;
    maximum = Math.max(maximum, ++active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    const attachment = fixtureAttachment(
      filename,
      filename,
      filename.endsWith('.png') ? 'image/png' : 'text/plain',
    );
    backend.uploadedFiles.set(attachment.id, attachment);
    await route.fulfill({ status: 201, json: { attachment } });
  });
  await page.goto('/');
  await page.locator('.chat-pane').evaluate((pane) => {
    const dataTransfer = new DataTransfer();
    for (let i = 0; i < 4; i++)
      dataTransfer.items.add(
        new File(['contents'], `drop-${i}.txt`, { type: 'text/plain' }),
      );
    pane.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
    );
  });
  const composer = page.getByRole('textbox', { name: 'Message pal' });
  await composer.evaluate((node, pngBytes) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([new Uint8Array(pngBytes)], 'paste.png', {
        type: 'image/png',
      }),
    );
    node.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  }, Array.from(attachmentPng));
  try {
    await expect(page.locator('.pending-file')).toHaveCount(5);
    await expect.poll(() => received).toBe(3);
    const remove = page.getByRole('button', {
      name: 'Remove drop-0.txt',
      exact: true,
    });
    const originalRemove = await remove.elementHandle();
    await remove.focus();
    await expect(
      page.getByRole('button', { name: 'Send message', exact: true }),
    ).toBeDisabled();
    releases[2]();
    releases[0]();
    releases[1]();
    await expect.poll(() => received).toBe(5);
    releases[4]();
    releases[3]();
    await expect(
      page.getByRole('button', { name: 'Send message', exact: true }),
    ).toBeEnabled();
    const scroller = page.locator('.pending-files-row');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const dimensions = await page
        .locator('.pending-file')
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const { width, height, top } = node.getBoundingClientRect();
            return { width, height, top };
          }),
        );
      expect(dimensions.map((pill) => pill.width)).toEqual(Array(5).fill(183));
      expect(dimensions.map((pill) => pill.height)).toEqual(Array(5).fill(52));
      expect(new Set(dimensions.map((pill) => pill.top)).size).toBe(1);
      expect(
        await scroller.evaluate((node) => node.scrollWidth > node.clientWidth),
      ).toBe(true);
      await scroller.evaluate((node) => {
        node.scrollLeft = 0;
      });
      await page
        .locator('.footer')
        .screenshot({ path: `test-results/pending-files-${width}-start.png` });
      await scroller.evaluate((node) => {
        node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2;
      });
      expect(
        await scroller.evaluate((node) => node.scrollLeft),
      ).toBeGreaterThan(0);
      await scroller.evaluate((node) => {
        node.scrollLeft = node.scrollWidth;
      });
      expect(
        await scroller.evaluate(
          (node) =>
            Math.abs(node.scrollLeft - (node.scrollWidth - node.clientWidth)) <
            1,
        ),
      ).toBe(true);
      await page
        .locator('.footer')
        .screenshot({ path: `test-results/pending-files-${width}-end.png` });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await scroller.evaluate((node) => {
        node.scrollLeft = 0;
      });
    }
    expect(await originalRemove!.evaluate((node) => node.isConnected)).toBe(
      true,
    );
    await expect(remove).toBeFocused();
    await composer.press('Enter');
    await expect.poll(() => backend.submissions.length).toBe(1);
    expect(backend.submissions[0].attachmentIds).toEqual([
      'drop-0.txt',
      'drop-1.txt',
      'drop-2.txt',
      'drop-3.txt',
      'paste.png',
    ]);
    expect(maximum).toBe(3);
  } finally {
    for (const release of releases) release();
  }
});

test('keeps inline images and keyboard focus during unrelated chat updates', async ({
  page,
}) => {
  const image = fixtureAttachment('stable-image', 'photo.png', 'image/png');
  const original = {
    ...backend.message('Photo', 'user'),
    attachments: [image],
  };
  backend.rows.push(original);
  await page.route('**/api/files/stable-image/content', (route) =>
    route.fulfill({ contentType: 'image/png', body: attachmentPng }),
  );
  await page.goto('/');
  const open = page.getByRole('button', {
    name: 'Open image 1 of 1: photo.png',
    exact: true,
  });
  await expect(page.locator('.image-cell')).toHaveAttribute(
    'data-state',
    'ready',
  );
  const originalImage = await open.locator('img').elementHandle();
  await open.focus();
  const answer = backend.message('Received photo');
  backend.publish(answer);
  backend.publish(backend.message('Next request', 'user'));
  backend.publish({ ...answer, version: 2, text: 'Updated response' });
  await expect(page.locator('#messages')).toContainText('Updated response');
  expect(await originalImage!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(open).toBeFocused();
  await expect(
    page.locator(`[data-message-id="${original.id}"] .message-read`),
  ).toHaveCount(0);
  await open.click();
  await expect(
    page.getByRole('dialog', { name: 'Image preview' }),
  ).toBeVisible();
});

test('keeps file-count errors in their chat and clears them when a file is removed', async ({
  page,
}) => {
  backend.taskRows = [
    {
      id: 'limit-task',
      version: 1,
      createdAt: '2026-10-08T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
      lastActivityAt: '2026-10-08T00:00:00.000Z',
      title: 'Limit task',
      goal: 'Read files',
      description: '',
      status: 'in-progress',
      archived: false,
    },
  ];
  await page.route('**/api/files', (route) =>
    route.fulfill({ status: 503, json: { message: 'Upload interrupted' } }),
  );
  await page.goto('/');
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await (
    await picker
  ).setFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('notes'),
  });
  await expect(page.locator('.pending-file')).toContainText(
    'Upload interrupted',
  );
  await page.locator('.chat-pane').evaluate((pane) => {
    const dataTransfer = new DataTransfer();
    for (let i = 0; i < 100; i++)
      dataTransfer.items.add(
        new File([''], `extra-${i}.txt`, { type: 'text/plain' }),
      );
    pane.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
    );
  });
  await expect(page.locator('#pending-files [role="alert"]')).toContainText(
    'at most 100 files',
  );
  await page.locator('#thread-open').click();
  await page
    .locator('#task-list')
    .getByRole('button', { name: /Limit task/ })
    .click();
  await expect(page.locator('#pending-files')).toBeHidden();
  await page.locator('#thread-open').click();
  await page.getByRole('button', { name: 'Main', exact: true }).click();
  await expect(page.locator('#pending-files [role="alert"]')).toContainText(
    'at most 100 files',
  );
  await page
    .getByRole('button', { name: 'Remove notes.txt', exact: true })
    .click();
  await expect(page.locator('#pending-files')).toBeHidden();
});
