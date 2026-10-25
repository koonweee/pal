import { expect, test } from '@playwright/test';
import type {
  Message,
  Preference,
  PreferenceRevision,
} from '../src/api/client';
import { backend, usePalBackend } from './support/pal-backend';

usePalBackend(test);

test('uses the shared agent name in conversation labels and live renames', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  const original = backend.message('Original answer');
  const user = {
    ...backend.message('Separate question', 'user'),
    reaction: '👀',
  };
  const quoted: Message = {
    ...backend.message('A reply to the original answer'),
    replyToMessageId: original.id,
    replyTo: {
      id: original.id,
      sequence: original.sequence,
      role: original.role,
      textPreview: original.text,
      taskId: original.taskId,
      phase: original.phase,
      mainVisible: false,
    },
  };
  backend.rows.push(original, user, quoted);
  expect(
    (
      await page.request.patch('/api/instance-settings', {
        data: { agentName: 'Riley' },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/');
  await expect(
    page.getByRole('article', { name: 'Riley', exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Reply to Riley’s message' })
    .last()
    .click();
  await page
    .getByRole('textbox', { name: 'Message Riley', exact: true })
    .fill('Still drafting');
  for (const name of ['Riley', 'Nova']) {
    if (name === 'Nova')
      expect(
        (
          await page.request.patch('/api/instance-settings', {
            data: { agentName: name },
          })
        ).ok(),
      ).toBe(true);
    await expect(page.getByRole('article', { name, exact: true })).toHaveCount(
      2,
    );
    await expect(
      page.getByRole('img', { name: `${name} reacted 👀` }),
    ).toBeVisible();
    await expect(page.locator('.message-quote strong')).toHaveText(name);
    await expect(page.locator('#composer-reply-role')).toHaveText(name);
    await expect(
      page.getByRole('textbox', { name: `Message ${name}`, exact: true }),
    ).toHaveValue('Still drafting');
    await expect(page.getByPlaceholder(`message ${name}`)).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Reply to ${name}’s message` }),
    ).toHaveCount(2);
    await expect(page.locator('#desktop-viewer')).toHaveAttribute(
      'title',
      `${name} desktop`,
    );
  }
  await page.getByRole('textbox', { name: 'Message Nova' }).press('Enter');
  await expect(page.getByText('Nova is typing', { exact: true })).toBeVisible({
    timeout: 3_000,
  });
  expect(
    (
      await page.request.patch('/api/instance-settings', {
        data: { agentName: 'Orbit' },
      })
    ).ok(),
  ).toBe(true);
  await expect(
    page.getByText('Orbit is typing', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'You', exact: true }),
  ).toHaveCount(2);
});

test('shares agent appearance across clients and keeps color scheme local', async ({
  page,
  browser,
  baseURL,
}) => {
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    await page.goto('/');
    await other.goto(baseURL!);
    await expect(page.getByPlaceholder('message pal')).toBeVisible();
    await expect(page.locator('#thread-open img')).toHaveCount(0);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      'href',
      /^data:image\/svg\+xml,/,
    );
    await page.getByRole('button', { name: 'Preferences' }).click();
    const dialog = page.getByRole('dialog', { name: 'Preferences' });
    await expect(dialog.getByRole('tab', { name: 'Memory' })).toBeVisible();
    await dialog.getByRole('tab', { name: 'Agent', exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Nova');
    await dialog.getByRole('button', { name: 'Save agent' }).click();
    await dialog.getByRole('tab', { name: 'Appearance' }).click();
    await expect(
      dialog.getByRole('textbox', { name: 'Name', exact: true }),
    ).not.toBeVisible();
    await dialog.getByRole('textbox', { name: 'Accent color' }).fill('#c026d3');
    await dialog.getByRole('button', { name: 'Save appearance' }).click();
    await expect(page.locator('.header .agent-label')).toHaveText('Nova');
    await expect(page.getByPlaceholder('message Nova')).toBeVisible();
    await expect(other.getByPlaceholder('message Nova')).toBeVisible();
    await expect(other.locator('#send')).toHaveCSS(
      'background-color',
      'rgb(192, 38, 211)',
    );
    await expect(page.locator('#send')).toHaveCSS(
      'color',
      'rgb(255, 255, 255)',
    );

    for (const client of [page, other])
      await expect(client.locator('link[rel="icon"]')).toHaveAttribute(
        'href',
        new RegExp(encodeURIComponent('#c026d3')),
      );

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0YkAAAAASUVORK5CYII=',
      'base64',
    );
    const id = 'c293a53c-696d-4bdc-b114-d3fb7c649181';
    await page.route('**/api/files', (route) =>
      route.fulfill({
        status: 201,
        json: {
          attachment: {
            id,
            filename: 'avatar.png',
            contentType: 'image/png',
            sizeBytes: png.length,
            createdAt: new Date().toISOString(),
          },
        },
      }),
    );
    for (const client of [page, other])
      await client.route(`**/api/files/${id}/content`, (route) =>
        route.fulfill({ contentType: 'image/png', body: png }),
      );
    await dialog.getByRole('tab', { name: 'Agent', exact: true }).click();
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await dialog.getByRole('button', { name: 'Save agent' }).click();
    await expect(page.locator('#thread-open img')).toHaveJSProperty(
      'naturalWidth',
      1,
    );
    await expect(other.locator('#thread-open img')).toHaveJSProperty(
      'naturalWidth',
      1,
    );
    for (const client of [page, other])
      await expect(client.locator('link[rel="icon"]')).toHaveAttribute(
        'href',
        new RegExp(`/api/files/${id}/content$`),
      );
    const manifest = await (
      await page.request.get('/manifest.webmanifest')
    ).json();
    expect(manifest.icons[0].src).toBe(`/api/files/${id}/content`);
    const appleIcon = await page.request.get('/apple-touch-icon.png', {
      maxRedirects: 0,
    });
    expect(appleIcon.headers().location).toBe(`/api/files/${id}/content`);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/apple-touch-icon.png',
    );
    await page.reload();
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      'href',
      new RegExp(`/api/files/${id}/content$`),
    );
    await expect(page.getByPlaceholder('message Nova')).toBeVisible();
    await expect(page.locator('#thread-open img')).toHaveJSProperty(
      'naturalWidth',
      1,
    );
    await page.getByRole('button', { name: 'Preferences' }).click();
    await dialog.getByRole('tab', { name: 'Appearance' }).click();
    await expect(
      dialog.getByRole('textbox', { name: 'Accent color' }),
    ).toHaveValue('#c026d3');
    await dialog.getByRole('radio', { name: 'Dark', exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');

    // A failed image request keeps the profile button usable with its donut fallback.
    await other.route(`**/api/files/${id}/content`, (route) =>
      route.fulfill({ status: 404 }),
    );
    await other.reload();
    await expect(
      other.locator('#thread-open .agent-avatar'),
    ).not.toHaveAttribute('data-image');
    await expect(other.locator('link[rel="icon"]')).toHaveAttribute(
      'href',
      new RegExp(encodeURIComponent('#c026d3')),
    );
    await other.locator('#thread-open').click();
    await expect(other.locator('#thread-sidebar')).toBeVisible();
    await other.unroute(`**/api/files/${id}/content`);
    await other.route(`**/api/files/${id}/content`, (route) =>
      route.fulfill({ contentType: 'image/png', body: png }),
    );
    for (const stream of backend.streams) stream.end();
    await expect(other.locator('#thread-open img')).toHaveJSProperty(
      'naturalWidth',
      1,
    );

    await expect(other.locator('link[rel="icon"]')).toHaveAttribute(
      'href',
      new RegExp(`/api/files/${id}/content$`),
    );

    await dialog.getByRole('tab', { name: 'Agent', exact: true }).click();
    await dialog.getByRole('button', { name: 'Reset to defaults' }).click();
    await dialog.getByRole('button', { name: 'Save agent' }).click();
    await expect(page.getByPlaceholder('message pal')).toBeVisible();
    await expect(other.getByPlaceholder('message pal')).toBeVisible();
    await expect(page.locator('#thread-open img')).toHaveCount(0);
    await expect(page.locator('#send')).toHaveCSS(
      'background-color',
      'rgb(192, 38, 211)',
    );
    for (const client of [page, other])
      await expect(client.locator('link[rel="icon"]')).toHaveAttribute(
        'href',
        new RegExp(encodeURIComponent('#c026d3')),
      );
    await dialog.getByRole('tab', { name: 'Appearance' }).click();
    await dialog.getByRole('button', { name: 'Reset to defaults' }).click();
    await dialog.getByRole('button', { name: 'Save appearance' }).click();
    await expect(other.locator('#send')).toHaveCSS(
      'background-color',
      'rgb(0, 102, 214)',
    );
    await expect(other.locator('link[rel="icon"]')).toHaveAttribute(
      'href',
      new RegExp(encodeURIComponent('#0066d6')),
    );
    await dialog.getByRole('tab', { name: 'App', exact: true }).click();
    await expect(
      dialog.getByRole('radio', { name: 'Update automatically when safe' }),
    ).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test('offers profile colors as touch-friendly accent drafts', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 320, height: 844 },
    baseURL,
  });
  const page = await context.newPage();
  try {
    const png = Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 30;
        canvas.height = 10;
        const drawing = canvas.getContext('2d')!;
        ['#ff0000', '#00ff00', '#0000ff'].forEach((color, i) => {
          drawing.fillStyle = color;
          drawing.fillRect(i * 10, 0, 10, 10);
        });
        return canvas.toDataURL('image/png').split(',')[1]!;
      }),
      'base64',
    );
    const id = 'eea1c89c-ec27-4e97-a90e-b8cf417c2774';
    await page.route(`**/api/files/${id}/content`, (route) =>
      route.fulfill({ contentType: 'image/png', body: png }),
    );
    expect(
      (
        await page.request.patch('/api/instance-settings', {
          data: { agentAvatarAttachmentId: id },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Preferences', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Preferences',
      exact: true,
    });
    await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click();
    const choices = dialog.getByRole('group', {
      name: 'Colors from profile image',
    });
    await expect(choices.getByRole('button')).toHaveCount(3);
    await expect(choices).toHaveText('');
    for (const button of await choices.getByRole('button').all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    const red = choices.getByRole('button', {
      name: 'Use #ff0000 as accent color',
    });
    await red.click();
    await expect(red).toHaveAttribute('aria-pressed', 'true');
    await expect(
      dialog.getByRole('textbox', { name: 'Accent color' }),
    ).toHaveValue('#ff0000');
    expect(
      (await (await page.request.get('/api/instance-settings')).json())
        .accentColor,
    ).toBe('#0066d6');
    await dialog.getByRole('button', { name: 'Save appearance' }).click();
    await expect(page.locator('#send')).toHaveCSS(
      'background-color',
      'rgb(255, 0, 0)',
    );
    expect(
      (await (await page.request.get('/api/instance-settings')).json())
        .accentColor,
    ).toBe('#ff0000');
    await page.request.patch('/api/instance-settings', {
      data: { agentAvatarAttachmentId: null },
    });
    await expect(choices).not.toBeVisible();
    const missing = 'a2028737-e05b-4b55-807d-ae3332d6ffdf';
    await page.route(`**/api/files/${missing}/content`, (route) =>
      route.fulfill({ status: 404 }),
    );
    const failed = page.waitForResponse(
      (response) =>
        response.url().includes(missing) && response.status() === 404,
    );
    await page.request.patch('/api/instance-settings', {
      data: { agentAvatarAttachmentId: missing },
    });
    await failed;
    await expect(choices).not.toBeVisible();
  } finally {
    await context.close();
  }
});

test('manages preference evidence, conflicts, history, restore, and retirement', async ({
  page,
}) => {
  const taskId = 'preference-source-task';
  backend.taskRows.push({
    id: taskId,
    title: 'Flight planning',
    goal: 'Choose a flight seat',
    description: '',
    status: 'in-progress',
    archived: false,
    version: 1,
    createdAt: '2026-10-06T08:00:00.000Z',
    updatedAt: '2026-10-06T08:00:00.000Z',
    lastActivityAt: '2026-10-06T08:00:00.000Z',
  });
  const source = {
    ...backend.message('I prefer aisle seats.', 'user'),
    taskId,
  };
  backend.rows.push(source);
  let preference: Preference = {
    id: '8dd577cf-2c80-45d9-aa9d-d631caa32ac5',
    createdAt: '2026-10-06T08:00:00.000Z',
    updatedAt: '2026-10-06T08:00:00.000Z',
    version: 1,
    topic: 'travel.flights',
    statement: 'Prefers aisle seats.',
    appliesWhen: 'Personal flights',
    basis: 'model-inferred',
    sourceMessageIds: [source.id],
    sources: [
      {
        id: source.id,
        sequence: source.sequence,
        taskId,
        createdAt: source.createdAt,
        textPreview: source.text,
      },
    ],
    status: 'active',
  };
  let revisions: PreferenceRevision[] = [
    {
      preferenceId: preference.id,
      version: 1,
      snapshot: { ...preference },
      actor: 'main',
      taskId: null,
      reason: 'Learned from the user message.',
      createdAt: preference.createdAt,
    },
  ];
  const appendRevision = (reason: string) => {
    revisions.unshift({
      preferenceId: preference.id,
      version: preference.version,
      snapshot: { ...preference },
      actor: 'human',
      taskId: null,
      reason,
      createdAt: preference.updatedAt,
    });
  };
  await page.route('**/api/preferences**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const history = url.pathname.endsWith('/history');
    const detail = /^\/api\/preferences\/[^/]+$/.test(url.pathname);
    if (request.method() === 'GET' && history) {
      await route.fulfill({ json: { revisions, after: null } });
      return;
    }
    if (request.method() === 'GET' && detail) {
      await route.fulfill({ json: preference });
      return;
    }
    if (request.method() === 'GET') {
      const status = url.searchParams.get('status') ?? 'active';
      await route.fulfill({
        json: {
          preferences: preference.status === status ? [preference] : [],
          after: null,
        },
      });
      return;
    }
    const input = request.postDataJSON();
    if (request.method() === 'PATCH') {
      if (input.expectedVersion !== preference.version) {
        await route.fulfill({
          status: 409,
          json: {
            message: 'Preference was changed by another editor',
            current: preference,
          },
        });
        return;
      }
      preference = {
        ...preference,
        ...input,
        basis: input.statement !== undefined ? 'user-stated' : preference.basis,
        version: preference.version + 1,
        updatedAt: new Date(
          Date.parse(preference.updatedAt) + 1000,
        ).toISOString(),
      };
      delete (preference as Preference & { expectedVersion?: number })
        .expectedVersion;
      delete (preference as Preference & { reason?: string }).reason;
      appendRevision(input.reason);
      await route.fulfill({ json: preference });
      return;
    }
    await route.fulfill({ status: 405, json: { message: 'Unsupported' } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await expect(dialog.locator('.preference-card')).toContainText(
    'Prefers aisle seats.',
  );
  await dialog.locator('.preference-card').click();
  await expect(dialog.locator('#preference-meta')).toContainText(
    'Model inferred',
  );
  await dialog.getByRole('button', { name: /I prefer aisle seats/ }).click();
  await expect(page.locator(`[data-message-id="${source.id}"]`)).toBeVisible();

  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await dialog.locator('.preference-card').click();
  await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog
    .getByRole('textbox', { name: 'Preference', exact: true })
    .fill('Prefers window seats.');
  preference = {
    ...preference,
    version: 2,
    updatedAt: '2026-10-06T08:00:01.000Z',
  };
  appendRevision('Concurrent model update.');
  await dialog.getByRole('button', { name: 'Save preference' }).click();
  await expect(dialog.getByText(/draft is preserved/i)).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Use current version', exact: true })
    .click();
  await expect(
    dialog.getByRole('textbox', { name: 'Preference', exact: true }),
  ).toHaveValue('Prefers window seats.');
  await dialog.getByRole('button', { name: 'Save preference' }).click();
  await expect(dialog.locator('#preference-statement')).toHaveText(
    'Prefers window seats.',
  );
  await expect(dialog.getByText('Version 3', { exact: true })).toBeVisible();

  await dialog
    .getByRole('button', { name: 'Restore as new version' })
    .last()
    .click();
  await expect(dialog.locator('#preference-statement')).toHaveText(
    'Prefers aisle seats.',
  );
  await dialog.getByRole('button', { name: 'Retire', exact: true }).click();
  await expect(
    dialog.getByText(/excluded from normal preference lookup/i),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(dialog.getByText('No matching preferences.')).toBeVisible();
  await dialog.getByLabel('Status').selectOption('retired');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(dialog.locator('.preference-card')).toContainText(
    'Prefers aisle seats.',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await dialog.getByLabel('Status').selectOption('retired');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(dialog.locator('.preference-card')).toContainText(
    'Prefers aisle seats.',
  );
});
