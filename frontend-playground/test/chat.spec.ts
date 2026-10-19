import { createServer, request as httpRequest } from 'node:http';
import type { ServerResponse } from 'node:http';
import { expect, test } from '@playwright/test';
import type {
  Message,
  TaskDetails,
  McpSnapshot,
  McpServer,
  Attachment,
  Preference,
  PreferenceRevision,
} from '../src/api';

// Real HTTP/SSE through Vite's proxy, with deterministic agent behavior.
let rows: Message[] = [];
const uploadedFiles = new Map<string, Attachment>();
let taskRows: TaskDetails[] = [];
let sequence = 0;
let working = false;
let failNextSend = false;
let holdNextHistory = false;
let holdNextSend = false;
let releasePersistence: (() => void) | undefined;
let releaseAcceptance: (() => void) | undefined;
let releaseHistory: (() => void) | undefined;
let submissions: {
  text: string;
  idempotencyKey: string;
  attachmentIds: string[];
  taskId?: string;
  replyToMessageId?: string;
  destinationId: 'web';
  metadata: { timezone: string };
}[] = [];
const streams = new Set<ServerResponse>();

function message(text: string, role: Message['role'] = 'assistant'): Message {
  sequence += 1;
  return {
    id: `message-${sequence}`,
    source: role === 'user' ? 'web' : null,
    originDestinationId: role === 'user' ? 'web' : null,
    participantDestinationIds: [],
    deliveryDestinationIds: [],
    notificationDestinationIds: [],
    notify: role === 'assistant',
    version: 1,
    idempotencyKey: null,
    replyToMessageId: null,
    replyTo: null,
    sequence,
    createdAt: '2026-10-06T08:00:00.000Z',
    role,
    text,
    taskId: null,
    phase: role === 'assistant' ? 'final_answer' : null,
    attachments: [],
  };
}
function emit(event: string, data: object) {
  for (const stream of streams)
    stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function publish(row: Message) {
  const index = rows.findIndex((current) => current.id === row.id);
  if (index === -1) rows.push(row);
  else rows[index] = row;
  const event = index === -1 ? 'message.added' : 'message.updated';
  emit(event, { event, message: row });
}
function json(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/stream') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    response.write('retry: 500\n\n');
    streams.add(response);
    response.write(
      `event: agent.activity\ndata: ${JSON.stringify({ event: 'agent.activity', state: { status: working ? 'working' : 'idle' } })}\n\n`,
    );
    request.on('close', () => streams.delete(response));
    return;
  }
  if (url.pathname === '/tasks') {
    const eligible = taskRows.filter(
      (task) => task.archived === (url.searchParams.get('archived') === 'true'),
    );
    json(response, 200, { tasks: eligible, after: null });
    return;
  }
  if (url.pathname.startsWith('/tasks/details/')) {
    const task = taskRows.find(
      (task) => task.id === url.pathname.split('/').at(-1),
    );
    json(
      response,
      task ? 200 : 404,
      task ? { task } : { message: 'Not found' },
    );
    return;
  }
  if (
    request.method === 'POST' &&
    url.pathname.startsWith('/tasks/') &&
    url.pathname.endsWith('/archive')
  ) {
    let body = '';
    for await (const chunk of request) body += chunk;
    const { archived } = JSON.parse(body) as { archived: boolean };
    const index = taskRows.findIndex(
      (task) => task.id === url.pathname.split('/')[2],
    );
    taskRows[index] = {
      ...taskRows[index]!,
      archived,
      version: taskRows[index]!.version + 1,
    };
    emit('task.updated', { event: 'task.updated', task: taskRows[index] });
    json(response, 201, {});
    return;
  }
  if (url.pathname === '/chat/history') {
    const cursor = Number(url.searchParams.get('before') ?? Infinity);
    const limit = Number(url.searchParams.get('limit'));
    const eligible = rows
      .filter(
        (row) =>
          row.sequence < cursor &&
          (url.searchParams.has('taskId')
            ? row.taskId === url.searchParams.get('taskId')
            : row.taskId === null ||
              (row.role === 'assistant' && row.phase === 'final_answer')),
      )
      .sort((a, b) => b.sequence - a.sequence);
    const page = eligible.slice(0, limit);
    // Capture the snapshot before the test interleaves a newer live event.
    const payload = JSON.parse(
      JSON.stringify({
        messages: page,
        before: eligible.length > limit ? page.at(-1)?.sequence : null,
      }),
    ) as object;
    if (holdNextHistory) {
      holdNextHistory = false;
      releaseHistory = () => {
        json(response, 200, payload);
        releaseHistory = undefined;
      };
    } else json(response, 200, payload);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/chat/messages') {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body) as (typeof submissions)[number];
    submissions.push(input);
    const replyTarget = rows.find((item) => item.id === input.replyToMessageId);
    const row = {
      ...message(input.text, 'user'),
      idempotencyKey: input.idempotencyKey,
      replyToMessageId: replyTarget?.id ?? null,
      replyTo: replyTarget
        ? {
            id: replyTarget.id,
            sequence: replyTarget.sequence,
            role: replyTarget.role,
            textPreview: replyTarget.text.slice(0, 160),
            taskId: replyTarget.taskId,
            phase: replyTarget.phase,
          }
        : null,
      taskId: input.taskId ?? null,
      phase: null,
      attachments: input.attachmentIds
        .map((id) => uploadedFiles.get(id)!)
        .filter(Boolean),
    };
    if (input.text === 'Delegate tickets') {
      const task: TaskDetails = {
        id: 'ticket-task',
        title: 'F1 tickets',
        goal: 'Find Friday tickets',
        description: 'Look for Friday tickets.',
        status: 'in-progress',
        archived: false,
        version: 1,
        createdAt: '2026-10-06T08:00:00.000Z',
        updatedAt: '2026-10-06T08:00:00.000Z',
      };
      taskRows.push(task);
      emit('task.added', { event: 'task.added', task });
    }
    if (holdNextSend) {
      holdNextSend = false;
      await new Promise<void>((resolve) => {
        releasePersistence = resolve;
      });
      publish(row);
      await new Promise<void>((resolve) => {
        releaseAcceptance = resolve;
      });
    } else publish(row);
    if (failNextSend) {
      failNextSend = false;
      json(response, 503, {
        message:
          'Agent could not accept the message. Send again with a new idempotency key.',
      });
    } else {
      working = true;
      emit('agent.activity', {
        event: 'agent.activity',
        state: { status: 'working' },
      });
      json(response, 201, { messageId: row.id });
    }
    return;
  }
  json(response, 404, { message: 'Not found' });
});

test.beforeAll(async () => {
  await new Promise<void>((resolve) =>
    server.listen(16991, '127.0.0.1', resolve),
  );
});
test.beforeEach(() => {
  for (const stream of streams) stream.end();
  streams.clear();
  rows = [];
  taskRows = [];
  sequence = 0;
  working = false;
  failNextSend = false;
  holdNextHistory = false;
  holdNextSend = false;
  releasePersistence = undefined;
  releaseAcceptance = undefined;
  releaseHistory = undefined;
  submissions = [];
  uploadedFiles.clear();
});
test.afterAll(async () => {
  for (const stream of streams) stream.end();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('configures MCP, hands OAuth to the browser, and shows busy Apply and connection errors', async ({
  page,
}) => {
  let saved: McpServer | undefined;
  let busyApply = true;
  let secret = '';
  const edits: {
    auth: {
      clientId?: string;
      clientMetadataUrl?: string;
      clientSecret?: string;
    };
  }[] = [];
  const snapshot = (): McpSnapshot => ({
    applyNeeded: saved?.applyNeeded ?? false,
    servers: saved ? [saved] : [],
  });
  await page.route('**/api/mcp/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let status = 200;
    let body: unknown = snapshot();
    if (
      (request.method() === 'POST' && path.endsWith('/servers')) ||
      request.method() === 'PATCH'
    ) {
      const input = request.postDataJSON();
      if (input.auth.clientSecret !== undefined)
        secret = input.auth.clientSecret;
      if (request.method() === 'PATCH') edits.push(input);
      saved = {
        id: 'server-1',
        name: input.name,
        url: input.url,
        enabled: input.enabled,
        auth: {
          type: 'oauth',
          clientId: input.auth.clientId,
          clientMetadataUrl: input.auth.clientMetadataUrl,
          scope: input.auth.scope,
          hasClientSecret: true,
        },
        hasLogin: false,
        loginPending: false,
        applyNeeded: true,
        status: { state: 'not-applied', toolCount: 0 },
      };
      status = 201;
      body = { id: saved.id };
    } else if (path.endsWith('/login')) {
      saved!.loginPending = true;
      status = 201;
      body = { authorizationUrl: 'http://127.0.0.1:16991/oauth-fixture' };
    } else if (path.endsWith('/apply')) {
      if (busyApply) {
        status = 409;
        body = {
          message:
            'Apply requires all agents to be idle. Try again when they finish.',
        };
      } else {
        saved!.applyNeeded = false;
        saved!.status = {
          state: 'error',
          toolCount: 0,
          error:
            'Connection or discovery failed. Check the server and retry Apply.',
        };
        body = snapshot();
      }
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'MCP settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Connected services' });
  await expect(settings.getByText('No servers configured')).toBeVisible();
  await expect(settings.getByLabel('Name', { exact: true })).not.toBeVisible();
  await settings
    .getByRole('button', { name: 'Add server', exact: true })
    .click();
  await settings.getByLabel('Name', { exact: true }).fill('research');
  await settings.getByLabel('Server URL').fill('https://example.com/mcp');
  await settings
    .getByLabel('Authentication', { exact: true })
    .selectOption('oauth');
  await settings.getByLabel('Client ID', { exact: true }).fill('pal-client');
  await settings
    .getByLabel('Client secret', { exact: true })
    .fill('private-secret');
  await settings
    .getByLabel('Scopes')
    .fill('service:read service:write offline_access');
  await expect(
    settings.getByLabel('Client metadata URL', { exact: true }),
  ).not.toBeVisible();
  await settings
    .getByRole('button', { name: 'Save server', exact: true })
    .click();
  await expect(
    settings.getByText(
      'Saved. Sign in if needed, then apply changes to connect.',
    ),
  ).toBeVisible();
  expect(secret).toBe('private-secret');
  await settings.getByText('Manage', { exact: true }).click();
  await settings.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(
    settings.getByLabel('Client secret', { exact: true }),
  ).toHaveValue('');
  await expect(settings.getByLabel('Name', { exact: true })).toBeDisabled();
  await settings.getByLabel('Client identity').selectOption('metadata');
  await expect(
    settings.getByLabel('Client ID', { exact: true }),
  ).not.toBeVisible();
  await settings
    .getByLabel('Client metadata URL', { exact: true })
    .fill('https://identity.example/client.json');
  await settings
    .getByRole('button', { name: 'Save server', exact: true })
    .click();
  await expect(settings.getByLabel('Name', { exact: true })).not.toBeVisible();
  expect(edits[0]!.auth).toMatchObject({
    clientId: '',
    clientMetadataUrl: 'https://identity.example/client.json',
  });
  expect(edits[0]!.auth).not.toHaveProperty('clientSecret');
  expect(secret).toBe('private-secret');
  const popupEvent = page.waitForEvent('popup');
  await settings.getByRole('button', { name: 'Sign in', exact: true }).click();
  const popup = await popupEvent;
  await popup.waitForURL('**/oauth-fixture');
  await expect(
    settings.getByText(
      'Finish signing in in the new tab. This window updates automatically.',
    ),
  ).toBeVisible();
  await expect(
    settings.getByRole('link', { name: 'Open sign-in page' }),
  ).toBeVisible();
  saved!.hasLogin = true;
  saved!.loginPending = false;
  await popup.close();
  await expect(
    settings.getByText('Login saved. Apply changes to connect.'),
  ).toBeVisible();
  await settings
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click();
  await expect(settings.getByRole('status')).toContainText(
    'all agents to be idle',
  );
  busyApply = false;
  await settings
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click();
  await expect(settings.getByText('All changes applied')).toBeVisible();
  await expect(
    settings.getByText('Connection failed', { exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole('button', { name: 'Retry connections' }),
  ).toBeVisible();
  await expect(
    settings.getByText(
      'Connection or discovery failed. Check the server and retry Apply.',
    ),
  ).toBeVisible();
  await settings.getByText('Manage', { exact: true }).click();
  await settings
    .getByRole('button', { name: 'Remove server', exact: true })
    .click();
  await expect(
    settings.getByText(
      'Remove research? Its loaded connection remains until you apply changes.',
    ),
  ).toBeVisible();
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(settings.getByText('research', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Close MCP settings' }).click();
  await expect(settings).not.toBeVisible();
});

test('edits private header rows, retains blank secrets, and saves bearer tokens without JSON input', async ({
  page,
}) => {
  let saved: McpServer = {
    id: 'server-headers',
    name: 'headers',
    url: 'https://example.com/mcp',
    enabled: true,
    auth: { type: 'headers', headerNames: ['X-Key', 'X-Region'] },
    hasLogin: false,
    loginPending: false,
    applyNeeded: false,
    status: { state: 'connected', toolCount: 3 },
  };
  const writes: { auth: { type: string; headers?: Record<string, string> } }[] =
    [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/mcp/**', async (route) => {
    const request = route.request();
    let body: unknown = { servers: [saved], applyNeeded: saved.applyNeeded };
    if (request.method() !== 'GET') {
      const input = request.postDataJSON();
      writes.push(input);
      saved = {
        ...saved,
        name: input.name,
        url: input.url,
        enabled: input.enabled,
        applyNeeded: true,
        auth: {
          type: 'headers',
          headerNames:
            input.auth.headers === undefined
              ? saved.auth.headerNames
              : Object.keys(input.auth.headers),
        },
      };
      body = { id: saved.id };
    }
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'MCP settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Connected services' });
  const edit = async () => {
    await settings.getByText('Manage', { exact: true }).click();
    await settings.getByRole('button', { name: 'Edit', exact: true }).click();
  };
  await edit();
  await expect(
    settings.getByLabel('Value', { exact: true }).first(),
  ).toHaveValue('');
  await settings.getByRole('button', { name: 'Save server' }).click();
  await expect(
    settings.getByText('Saved. Apply changes to connect.'),
  ).toBeVisible();
  expect(writes[0]!.auth).toEqual({ type: 'headers' });
  await edit();
  await settings
    .getByLabel('Value', { exact: true })
    .first()
    .fill('replacement-key');
  await settings.getByRole('button', { name: 'Save server' }).click();
  await expect(settings.getByRole('status')).toContainText(
    'Enter a value for every header',
  );
  expect(writes).toHaveLength(1);
  await settings.getByLabel('Value', { exact: true }).nth(1).fill('region');
  await settings.getByRole('button', { name: 'Save server' }).click();
  await expect(
    settings.getByText('Saved. Apply changes to connect.'),
  ).toBeVisible();
  expect(writes[1]!.auth.headers).toEqual({
    'X-Key': 'replacement-key',
    'X-Region': 'region',
  });
  await edit();
  await settings
    .getByRole('button', { name: 'Remove', exact: true })
    .first()
    .click();
  await settings.getByRole('button', { name: 'Remove', exact: true }).click();
  await settings.getByRole('button', { name: 'Save server' }).click();
  await expect(
    settings.getByText('Saved. Apply changes to connect.'),
  ).toBeVisible();
  expect(writes[2]!.auth.headers).toEqual({});
  await settings.getByRole('button', { name: 'Add server' }).click();
  await expect(settings.getByLabel('Name', { exact: true })).toBeFocused();
  await settings.getByLabel('Name', { exact: true }).fill('token');
  await settings.getByLabel('Server URL').fill('https://example.com/token');
  await settings.getByLabel('Authentication').selectOption('bearer');
  await settings
    .getByLabel('Bearer token', { exact: true })
    .fill('fixture-token');
  await settings.getByRole('button', { name: 'Save server' }).click();
  await expect(
    settings.getByText('Saved. Apply changes to connect.'),
  ).toBeVisible();
  expect(writes[3]!.auth).toEqual({
    type: 'headers',
    headers: { Authorization: 'Bearer fixture-token' },
  });
  await edit();
  await expect(settings.getByLabel('Value', { exact: true })).toHaveValue('');
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    settings.getByRole('button', { name: 'Add server' }),
  ).toBeFocused();
  await expect(
    settings.getByRole('heading', { name: 'Connected services' }),
  ).toBeInViewport();
});

test('manages preference evidence, conflicts, history, restore, and retirement', async ({
  page,
}) => {
  const taskId = 'preference-source-task';
  taskRows.push({
    id: taskId,
    title: 'Flight planning',
    goal: 'Choose a flight seat',
    description: '',
    status: 'in-progress',
    archived: false,
    version: 1,
    createdAt: '2026-10-06T08:00:00.000Z',
    updatedAt: '2026-10-06T08:00:00.000Z',
  });
  const source = {
    ...message('I prefer aisle seats.', 'user'),
    taskId,
  };
  rows.push(source);
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
    .getByLabel('Preference', { exact: true })
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
  await expect(dialog.getByLabel('Preference', { exact: true })).toHaveValue(
    'Prefers window seats.',
  );
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

test('reconciles snapshots, live follow-ups, older history, reconnect, and reload', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  for (let i = 1; i <= 75; i++) rows.push(message(`Message ${i}`));
  holdNextHistory = true;
  await page.route('**/vnc.html', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  );
  await page.goto('/');
  await expect(page.locator('#desktop-status')).toHaveText(
    'Desktop unavailable. Chat is still available.',
  );
  await expect.poll(() => Boolean(releaseHistory)).toBe(true);
  const newest = {
    ...rows[74]!,
    version: 2,
    text: '**Updated while loading** <img src=x onerror="window.unsafe=true"><script>window.unsafe=true</script> [unsafe](javascript:alert(1))',
  };
  publish(newest);
  releaseHistory!();
  const articles = page.locator('article.message');
  await expect(articles).toHaveCount(30);
  await expect(articles.last().locator('strong')).toHaveText(
    'Updated while loading',
  );
  await expect(
    articles.last().locator('img, script, a[href^="javascript:"]'),
  ).toHaveCount(0);
  await expect(articles.first()).toContainText('Message 46');
  const composer = page.getByRole('textbox', { name: 'Message Pal' });
  await composer.fill('First message');
  await composer.press('Shift+Enter');
  await composer.press('x');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect(page.locator('#activity')).toHaveText('Working');
  await composer.fill('Follow-up during work');
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeEnabled();
  await composer.press('Enter');
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[0]!.text).toBe('First message\nx');
  expect(submissions[0]!.attachmentIds).toEqual([]);
  expect(submissions[0]!.destinationId).toBe('web');
  expect(submissions[0]!.metadata.timezone).toBe(
    await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  expect(submissions[1]!.idempotencyKey).not.toBe(
    submissions[0]!.idempotencyKey,
  );
  publish(message('One response to both messages.'));
  working = false;
  emit('agent.activity', {
    event: 'agent.activity',
    state: { status: 'idle' },
  });
  await expect(articles).toHaveCount(33);
  await expect(articles.last()).toContainText('One response to both messages.');
  await expect(page.locator('#activity')).toHaveText('Idle');
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(articles).toHaveCount(63);
  await expect(articles.first()).toContainText('Message 16');
  await page.screenshot({ path: 'test-results/playground-desktop.png' });

  // Simulate an abrupt backend disconnect, including events lost on an older page.
  for (const stream of streams) stream.destroy();
  streams.clear();
  rows[29] = { ...rows[29]!, version: 2, text: 'Changed during outage' };
  rows[39] = {
    ...rows[39]!,
    version: 2,
    taskId: 'task-1',
    phase: 'commentary',
  };
  rows.push(message('Reply while disconnected'));
  holdNextHistory = true;
  await expect(page.locator('#connection')).toHaveText('Reconnecting…');
  await expect.poll(() => Boolean(releaseHistory)).toBe(true);
  releaseHistory!();
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(
    page.getByText('Changed during outage', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Message 40', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Reply while disconnected', { exact: true }),
  ).toHaveCount(1);
  await expect(articles).toHaveCount(63);
  expect(
    await articles.evaluateAll(
      (nodes) =>
        new Set(nodes.map((node) => node.getAttribute('data-message-id'))).size,
    ),
  ).toBe(63);
  await page.reload();
  await expect(articles).toHaveCount(30);
  await expect(articles.last()).toContainText('Reply while disconnected');
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

test('marks read on persistence before agent acceptance and restores receipts from snapshots', async ({
  page,
}) => {
  rows.push(message('Earlier message', 'user'));
  rows.push(message('Earlier answer'));
  await page.goto('/');
  const users = page.locator('article.user');
  await expect(users.first().locator('.message-read')).toContainText('Read ');
  await expect(page.locator('article.assistant .message-read')).toHaveCount(0);
  holdNextSend = true;
  await page
    .getByRole('textbox', { name: 'Message Pal' })
    .fill('Read this promptly');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  try {
    await expect.poll(() => Boolean(releasePersistence)).toBe(true);
    await expect(users).toHaveCount(2);
    await expect(users.last()).toContainText('Read this promptly');
    await expect(page.locator('.message-read')).toHaveCount(0);
    await expect(page.locator('#composer-status')).not.toContainText(
      /pending|sending/i,
    );
    releasePersistence!();
    await expect.poll(() => Boolean(releaseAcceptance)).toBe(true);
    await expect(users.last().locator('.message-read')).toContainText('Read ');
    await expect(users).toHaveCount(2);
    // The POST remains blocked on agent acceptance while SSE has marked Read.
    await expect(
      page.getByRole('button', { name: 'Send message', exact: true }),
    ).toBeDisabled();
    releaseAcceptance!();
    await expect(
      page.getByRole('textbox', { name: 'Message Pal' }),
    ).toHaveValue('');
    // Lose an SSE publication and reconcile the optimistic bubble by snapshot.
    holdNextSend = true;
    releasePersistence = undefined;
    releaseAcceptance = undefined;
    await page.getByRole('textbox', { name: 'Message Pal' }).fill('hi');
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect.poll(() => Boolean(releasePersistence)).toBe(true);
    for (const stream of streams) stream.end();
    streams.clear();
    releasePersistence!();
    await expect.poll(() => Boolean(releaseAcceptance)).toBe(true);
    await expect(users).toHaveCount(3);
    await expect(users.last().locator('.message-read')).toContainText('Read ');
    releaseAcceptance!();
    await expect(
      page.getByRole('textbox', { name: 'Message Pal' }),
    ).toHaveValue('');
    await page.reload();
    await expect(users).toHaveCount(3);
    await expect(page.locator('article.user .message-read')).toHaveCount(1);
    await expect(users.last().locator('.message-read time')).toHaveAttribute(
      'datetime',
      rows.at(-1)!.createdAt,
    );
    await expect(page.locator('.message-meta')).toHaveCount(0);
    const bubble = users.last().locator('.message-bubble');
    const receipt = users.last().locator('.message-read');
    expect((await bubble.boundingBox())!.width).toBeLessThan(
      (await receipt.boundingBox())!.width,
    );
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
    releasePersistence?.();
    releaseAcceptance?.();
  }
});

test('composes replies and navigates to quoted messages in older history', async ({
  page,
}) => {
  for (let i = 1; i <= 65; i++) rows.push(message(`Prior ${i}`));
  const target = rows[1]!;
  const recent = rows.at(-1)!;
  await page.goto('/');
  const recentArticle = page.locator(`[data-message-id="${recent.id}"]`);
  await recentArticle
    .getByRole('button', { name: 'Reply to Pal’s message' })
    .click();
  await expect(page.locator('#composer-reply')).toContainText('Prior 65');
  await page.getByRole('button', { name: 'Cancel reply' }).click();
  await expect(page.locator('#composer-reply')).toBeHidden();
  await recentArticle
    .getByRole('button', { name: 'Reply to Pal’s message' })
    .click();
  const draft = page.getByRole('textbox', { name: 'Message Pal' });
  await draft.fill('About the recent one');
  failNextSend = true;
  await draft.press('Enter');
  await expect(page.locator('#send-error')).toBeVisible();
  await expect(page.locator('#composer-reply')).toContainText('Prior 65');
  await draft.press('Enter');
  await expect.poll(() => submissions.length).toBe(2);
  await expect.poll(() => submissions.at(-1)?.replyToMessageId).toBe(recent.id);
  const saved = rows.at(-1)!;
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
    ...message('A later answer to an older message'),
    replyToMessageId: target.id,
    replyTo: {
      id: target.id,
      sequence: target.sequence,
      role: target.role,
      textPreview: target.text,
      taskId: target.taskId,
      phase: target.phase,
    },
  } satisfies Message;
  publish(delayed);
  await page
    .locator(`[data-message-id="${delayed.id}"]`)
    .getByRole('button', { name: 'View quoted message' })
    .click();
  await expect(page.locator(`[data-message-id="${target.id}"]`)).toHaveClass(
    /quote-highlight/,
  );
  const absent = {
    ...message('Answer quoting another client'),
    replyToMessageId: 'not-in-this-client',
    replyTo: {
      id: 'not-in-this-client',
      sequence: 1,
      role: 'user' as const,
      textPreview: 'Sent from another client',
      taskId: null,
      phase: null,
    },
  } satisfies Message;
  publish(absent);
  const absentArticle = page.locator(`[data-message-id="${absent.id}"]`);
  await expect(absentArticle).toContainText('Sent from another client');
  await absentArticle
    .getByRole('button', { name: 'View quoted message' })
    .click();
  await expect(absentArticle).toBeVisible();
});

test('keeps task-only quotes in task chat while sharing the final in Main', async ({
  page,
}) => {
  taskRows.push({
    id: 'quote-task',
    title: 'Quote task',
    goal: 'Check reply visibility',
    description: '',
    status: 'in-progress',
    archived: false,
    version: 1,
    createdAt: '2026-10-06T08:00:00.000Z',
    updatedAt: '2026-10-06T08:00:00.000Z',
  });
  const taskOnly: Message = {
    ...message('Task-only detail'),
    taskId: 'quote-task',
    phase: 'commentary',
  };
  rows.push(taskOnly);
  const final: Message = {
    ...message('Shared conclusion'),
    taskId: 'quote-task',
    phase: 'final_answer',
    replyToMessageId: taskOnly.id,
    replyTo: {
      id: taskOnly.id,
      sequence: taskOnly.sequence,
      role: taskOnly.role,
      textPreview: taskOnly.text,
      taskId: taskOnly.taskId,
      phase: taskOnly.phase,
    },
  };
  rows.push(final);
  await page.goto('/');
  await expect(page.locator(`[data-message-id="${final.id}"]`)).toBeVisible();
  await expect(
    page.locator(`[data-message-id="${final.id}"] .message-quote`),
  ).toHaveCount(0);
  await page.locator('[data-task-id="quote-task"]').click();
  await expect(
    page.locator(`[data-message-id="${final.id}"] .message-quote`),
  ).toContainText('Task-only detail');
  await page
    .locator(`[data-message-id="${taskOnly.id}"]`)
    .getByRole('button', { name: 'Reply to Pal’s message' })
    .click();
  await page
    .getByRole('textbox', { name: 'Message Pal' })
    .fill('Please expand');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect
    .poll(() => submissions.at(-1)?.replyToMessageId)
    .toBe(taskOnly.id);
  expect(submissions.at(-1)?.taskId).toBe('quote-task');
});

test('preserves a failed submission and resends only on explicit input with a fresh key', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#connection')).toHaveText('Connected');
  const composer = page.getByRole('textbox', { name: 'Message Pal' });
  const button = page.getByRole('button', {
    name: 'Send message',
    exact: true,
  });
  await composer.fill('Keep this draft');
  await expect(button).toBeEnabled();
  failNextSend = true;
  await button.click();
  await expect(page.locator('#send-error')).toContainText(
    'Your message may already be saved',
  );
  await expect(composer).toHaveValue('Keep this draft');
  await expect(page.locator('article.user')).toHaveCount(1);
  await expect(page.locator('article.user .message-read')).toContainText(
    'Read ',
  );
  await expect(button).toBeEnabled();
  expect(submissions).toHaveLength(1);
  await button.click();
  await expect(composer).toHaveValue('');
  await expect(page.locator('article.user')).toHaveCount(2);
  expect(submissions).toHaveLength(2);
  expect(submissions[1]!.idempotencyKey).not.toBe(
    submissions[0]!.idempotencyKey,
  );
  await expect(page.locator('#send-error')).toBeHidden();
});

test('opens the desktop sheet without remounting the preloaded viewer', async ({
  page,
}) => {
  await page.route('**/viewer-bridge.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  let viewerLoads = 0;
  await page.route('**/vnc.html**', (route) => {
    if (route.request().isNavigationRequest()) viewerLoads += 1;
    return route.fulfill({
      contentType: 'text/html',
      body: '<html class="noVNC_connected"><title>Desktop fixture</title><label>Desktop input<input></label></html>',
    });
  });
  await page.addInitScript(() => localStorage.setItem('pal-theme', 'dark'));
  let markEntryRequested!: () => void;
  let releaseEntry!: () => void;
  const entryRequested = new Promise<void>((resolve) => {
    markEntryRequested = resolve;
  });
  const entryReleased = new Promise<void>((resolve) => {
    releaseEntry = resolve;
  });
  await page.route('**/src/main.ts', async (route) => {
    markEntryRequested();
    await entryReleased;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });
  try {
    await entryRequested;
    // Styles and saved theme must already be correct while application JS is held.
    await expect(page.locator('.header')).toHaveCSS('display', 'flex');
    await expect(page.locator('html')).toHaveCSS(
      'background-color',
      'rgb(0, 0, 0)',
    );
    await expect(page.locator('#desktop-sheet')).not.toBeInViewport();
    await expect(page.locator('#desktop-sheet')).toHaveCSS(
      'transition-duration',
      '0s',
    );
  } finally {
    releaseEntry();
  }
  await page.waitForLoadState('load');
  const sheet = page.locator('#desktop-sheet');
  const trigger = page.getByRole('button', { name: 'Open desktop' });
  const frame = page.locator('#desktop-viewer');
  const input = page
    .frameLocator('#desktop-viewer')
    .getByRole('textbox', { name: 'Desktop input' });
  await expect.poll(() => viewerLoads).toBe(1);
  await expect(input).toHaveCount(1);
  await expect(sheet).not.toBeInViewport();
  await expect(sheet).toHaveAttribute('inert', '');
  expect(
    await frame.evaluate(
      (node) => node.clientWidth > 0 && node.clientHeight > 0,
    ),
  ).toBe(true);

  await trigger.click();
  await expect(
    page.getByRole('dialog', { name: 'Desktop', exact: true }),
  ).toBeInViewport();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#desktop-retry')).toBeHidden();
  const viewerDocument = page
    .frames()
    .find((current) => current.url().includes('/vnc.html?'))!;
  await viewerDocument.evaluate(() =>
    document.documentElement.classList.remove('noVNC_connected'),
  );
  await expect(page.locator('#desktop-retry')).toBeVisible();
  await viewerDocument.evaluate(() =>
    document.documentElement.classList.add('noVNC_connected'),
  );
  await expect(page.locator('#desktop-retry')).toBeHidden();
  await input.fill('Keep viewer state');
  await page.locator('#desktop-close').click();
  await expect(trigger).toBeFocused();
  await expect(sheet).not.toBeInViewport();
  expect(
    await frame.evaluate(
      (node) => node.clientWidth > 0 && node.clientHeight > 0,
    ),
  ).toBe(true);

  await trigger.click();
  await expect(input).toHaveValue('Keep viewer state');
  await page.locator('#desktop-close').press('Escape');
  await expect(trigger).toBeFocused();
  await expect(sheet).toHaveAttribute('data-open', 'false');

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(sheet).toBeInViewport();
  const dimensions = await frame.evaluate((node) => ({
    width: node.clientWidth,
    height: node.clientHeight,
  }));
  expect(Math.abs(dimensions.width / dimensions.height - 4 / 3)).toBeLessThan(
    0.01,
  );
  expect((await sheet.boundingBox())!.height).toBeLessThan(420);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/desktop-sheet-mobile.png' });
  await page.locator('#desktop-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(trigger).toBeFocused();
  await expect(sheet).not.toBeInViewport();
  expect(viewerLoads).toBe(1);
  await expect(input).toHaveValue('Keep viewer state');
});

for (const width of [1280, 390]) {
  test(`keeps composer focus when the hidden desktop initializes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/viewer-bridge.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: '' }),
    );
    await page.route('**/vnc.html**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html class="noVNC_connected"><canvas tabindex="0"></canvas></html>',
      }),
    );
    await page.goto('/');
    const canvas = page.frameLocator('#desktop-viewer').locator('canvas');
    await expect(canvas).toHaveCount(1);
    const composer = page.getByRole('textbox', { name: 'Message Pal' });
    await composer.click();
    // noVNC focuses its canvas after asynchronously connecting or reconnecting.
    await canvas.evaluate((node) => node.focus());
    await expect(composer).toBeFocused();
    await page.keyboard.type('Keep typing');
    await expect(composer).toHaveValue('Keep typing');
    await page.getByRole('button', { name: 'Open desktop' }).click();
    await canvas.evaluate((node) => node.focus());
    await expect(canvas).toBeFocused();
    await page.locator('#desktop-close').click();
    await composer.click();
    await canvas.evaluate((node) => node.focus());
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue('Keep typing');
  });
}

test('loads current desktop modules when the original viewer is cached', async ({
  page,
  baseURL,
}) => {
  const fixture = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const legacy =
      path.startsWith('/desktop/') && !/^\/desktop\/v\d+\//.test(path);
    const asset = legacy ? path.slice('/desktop'.length) : path;
    const version = legacy ? 'cached' : 'current';
    const assets: Record<string, string> = {
      '/vnc.html':
        '<html class="noVNC_connected"><script type="module" src="./app/ui.js"></script></html>',
      '/app/ui.js':
        'import { version } from "../core/version.js"; document.documentElement.dataset.version = version; export default { connected: false };',
      '/core/version.js': `export const version = '${version}';`,
      '/core/input/keysym.js': 'export default {};',
    };
    if (asset in assets) {
      response.writeHead(200, {
        'Content-Type': asset.endsWith('.html')
          ? 'text/html'
          : 'text/javascript',
        'Cache-Control': asset.endsWith('.html')
          ? 'no-cache'
          : 'public, max-age=86400',
      });
      response.end(assets[asset]);
      return;
    }
    const forwarded = httpRequest(
      `${baseURL}${request.url}`,
      {
        method: request.method,
      },
      (upstream) => {
        response.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(response);
      },
    );
    response.on('close', () => forwarded.destroy());
    forwarded.on('error', () => response.destroy());
    request.pipe(forwarded);
  });
  await new Promise<void>((resolve) =>
    fixture.listen(16993, '127.0.0.1', resolve),
  );
  try {
    // Populate this origin's cache with the original module URLs before visiting Pal.
    await page.goto('http://127.0.0.1:16993/desktop/vnc.html');
    await expect(page.locator('html')).toHaveAttribute(
      'data-version',
      'cached',
    );
    await page.goto('http://127.0.0.1:16993/');
    const viewer = page.frameLocator('#desktop-viewer');
    await expect(viewer.locator('html')).toHaveAttribute(
      'data-version',
      'current',
    );
    await page.reload();
    await expect(viewer.locator('html')).toHaveAttribute(
      'data-version',
      'current',
    );
    const source = await page.locator('#desktop-viewer').getAttribute('src');
    const moduleURL = new URL('./app/ui.js', new URL(source!, page.url()));
    const moduleResponse = await page.request.get(moduleURL.href);
    expect(moduleResponse.headers()['cache-control']).toBe('no-cache');
  } finally {
    await page.goto('about:blank');
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});

test('desktop header toggles keyboard and fullscreen without remounting the viewer', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.addInitScript(() =>
    Object.defineProperty(document, 'fullscreenEnabled', {
      value: false,
      configurable: true,
    }),
  );
  await page.route('**/viewer-bridge.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  let viewerLoads = 0;
  await page.route('**/vnc.html**', (route) => {
    if (route.request().isNavigationRequest()) viewerLoads += 1;
    return route.fulfill({
      contentType: 'text/html',
      body: `<html class="noVNC_connected">
      <button id="noVNC_keyboard_button">Keyboard</button>
      <button id="noVNC_fullscreen_button">Fullscreen</button>
      <textarea id="noVNC_keyboardinput"></textarea>
      <script>
        const input = document.querySelector('textarea');
        const button = document.querySelector('#noVNC_keyboard_button');
        button.onclick = () => document.activeElement === input ? input.blur() : input.focus();
        input.onfocus = () => button.classList.add('noVNC_selected');
        input.onblur = () => button.classList.remove('noVNC_selected');
      </script></html>`,
    });
  });
  try {
    await page.goto(baseURL!);
    await page.getByRole('button', { name: 'Open desktop' }).tap();
    const keyboard = page.getByRole('button', {
      name: 'Toggle desktop keyboard',
    });
    const input = page
      .frameLocator('#desktop-viewer')
      .locator('#noVNC_keyboardinput');
    await expect(keyboard).toBeEnabled();
    await keyboard.tap();
    await expect(input).toBeFocused();
    await expect(keyboard).toHaveAttribute('aria-pressed', 'true');
    // Mobile browsers can blur the iframe before delivering the header click.
    await page.evaluate(() => {
      document.querySelector('#desktop-keyboard')!.addEventListener(
        'pointerdown',
        () => {
          document
            .querySelector<HTMLIFrameElement>('#desktop-viewer')!
            .contentDocument!.querySelector<HTMLTextAreaElement>(
              '#noVNC_keyboardinput',
            )!
            .blur();
        },
        { once: true },
      );
    });
    await keyboard.tap();
    await expect(input).not.toBeFocused();
    await expect(keyboard).toHaveAttribute('aria-pressed', 'false');

    await page.getByRole('button', { name: 'Enter desktop fullscreen' }).tap();
    const sheet = page.locator('#desktop-sheet');
    await expect(sheet).toHaveAttribute('data-fullscreen', 'true');
    await expect(
      page.getByRole('button', { name: 'Exit desktop fullscreen' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const bounds = (await sheet.boundingBox())!;
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.width).toBe(390);
    expect(bounds.height).toBe(844);
    await keyboard.tap();
    await expect(input).toBeFocused();
    await keyboard.tap();
    await page
      .getByRole('button', { name: 'Exit desktop fullscreen' })
      .press('Escape');
    await expect(sheet).toHaveAttribute('data-fullscreen', 'false');
    await expect(sheet).toHaveAttribute('data-open', 'true');

    // Exercise the native API separately from the phone viewport fallback.
    await page.evaluate(() =>
      Reflect.deleteProperty(document, 'fullscreenEnabled'),
    );
    await page.getByRole('button', { name: 'Enter desktop fullscreen' }).tap();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id))
      .toBe('desktop-sheet');
    await page.getByRole('button', { name: 'Exit desktop fullscreen' }).tap();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement))
      .toBeNull();
    await expect(sheet).toHaveAttribute('data-fullscreen', 'false');
    await page.getByRole('button', { name: 'Enter desktop fullscreen' }).tap();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id))
      .toBe('desktop-sheet');
    await page.locator('#desktop-close').tap();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement))
      .toBeNull();
    await expect(sheet).toHaveAttribute('data-open', 'false');
    expect(viewerLoads).toBe(1);
  } finally {
    await context.close();
  }
});

test('desktop paste sends Unicode clipboard text before the shortcut and handles access failures', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        readText: async () => {
          if (document.body.dataset.clipboardDenied === 'true') {
            throw new DOMException('Denied', 'NotAllowedError');
          }
          return document.body.dataset.clipboardText ?? '';
        },
      },
    });
  });
  let viewerLoads = 0;
  await page.route('**/vnc.html**', (route) => {
    if (route.request().isNavigationRequest()) viewerLoads += 1;
    return route.fulfill({
      contentType: 'text/html',
      body: '<html class="noVNC_connected"><title>Desktop paste fixture</title></html>',
    });
  });
  await page.route('**/app/ui.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `const calls = [];
        const record = (...args) => {
          calls.push(args);
          document.documentElement.dataset.calls = JSON.stringify(calls);
        };
        export default {
          get connected() { return document.documentElement.classList.contains('noVNC_connected'); },
          rfb: {
            viewOnly: false,
            clipboardPasteFrom: text => record('clipboard', text),
            sendKey: (...args) => record('key', ...args),
            focus: () => record('focus'),
          },
        };`,
    }),
  );
  await page.route('**/core/input/keysym.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export default { XK_Shift_L: 0xffe1, XK_Insert: 0xff63 };',
    }),
  );
  try {
    await page.goto(baseURL!);
    await page
      .getByRole('button', { name: 'Select thread: Main', exact: true })
      .tap();
    await expect(
      page.getByRole('dialog', { name: 'Conversations' }),
    ).toBeVisible();
    await expect(page.locator('#main-chat')).toBeFocused();
    expect(
      await page
        .locator('#main-chat')
        .evaluate((node) => getComputedStyle(node).outlineStyle),
    ).toBe('none');
    await page.screenshot({ path: 'test-results/thread-sidebar-touch.png' });
    await page.getByRole('button', { name: 'Close thread sidebar' }).tap();
    await page.getByRole('button', { name: 'Open desktop' }).tap();
    const paste = page.getByRole('button', {
      name: 'Paste clipboard into desktop',
    });
    const viewer = page.frameLocator('#desktop-viewer').locator('html');
    const text = 'Clipboard 中文 😀\nsecond line';
    await page.evaluate((value) => {
      document.body.dataset.clipboardText = value;
    }, text);
    await expect(paste).toBeEnabled();
    await paste.tap();
    const expectedCalls = JSON.stringify([
      ['clipboard', text],
      ['key', 0xffe1, 'ShiftLeft', true],
      ['key', 0xff63, 'Insert'],
      ['key', 0xffe1, 'ShiftLeft', false],
      ['focus'],
    ]);
    await expect(viewer).toHaveAttribute('data-calls', expectedCalls);
    await expect(page.locator('#desktop-status')).toBeHidden();

    await page.evaluate(() => {
      document.body.dataset.clipboardDenied = 'true';
    });
    await paste.tap();
    await expect(page.locator('#desktop-status')).toHaveText(
      'Could not read clipboard. Allow clipboard access and try again.',
    );
    await expect(paste).toBeEnabled();
    await expect(viewer).toHaveAttribute('data-calls', expectedCalls);

    await page.evaluate(() => {
      document.body.dataset.clipboardDenied = 'false';
      document.body.dataset.clipboardText = '';
    });
    await paste.tap();
    await expect(page.locator('#desktop-status')).toHaveText(
      'Your clipboard contains no text.',
    );
    await expect(viewer).toHaveAttribute('data-calls', expectedCalls);

    await viewer.evaluate((root) => root.classList.remove('noVNC_connected'));
    await expect(paste).toBeDisabled();
    expect(viewerLoads).toBe(1);
  } finally {
    await context.close();
  }
});

test('delegates into task chat, steers, shares finals, archives, and reconnects', async ({
  page,
}) => {
  await page.route('**/vnc.html', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  );
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Pal' });
  await composer.fill('Delegate tickets');
  await composer.press('Enter');
  await expect(page.locator('#task-list')).toContainText('F1 tickets');
  await page
    .locator('#task-list')
    .getByRole('button', { name: /F1 tickets/ })
    .click();
  await expect(page.locator('#chat-title')).toHaveText('F1 tickets');
  await expect(page.locator('#task-description')).toHaveText(
    'Look for Friday tickets.',
  );
  const commentary: Message = {
    ...message('Checking ticket sites'),
    taskId: taskRows[0]!.id,
    phase: 'commentary',
  };
  publish(commentary);
  await expect(page.locator('#messages')).toContainText(
    'Checking ticket sites',
  );
  await composer.fill('Friday only, under $500');
  await composer.press('Enter');
  await expect.poll(() => submissions.at(-1)?.taskId).toBe(taskRows[0]!.id);
  expect(submissions.at(-1)!.metadata.timezone).toBe(
    await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  await expect(page.locator('#messages')).toContainText(
    'Friday only, under $500',
  );
  await expect(page.locator('article.user .message-read')).toContainText(
    'Read ',
  );
  const final: Message = {
    ...message('Friday tickets are available'),
    taskId: taskRows[0]!.id,
    phase: 'final_answer',
  };
  publish(final);
  taskRows[0] = { ...taskRows[0]!, status: 'needs-input', version: 2 };
  emit('task.updated', { event: 'task.updated', task: taskRows[0] });
  await expect(page.locator('#task-status')).toHaveText('needs-input');
  await expect(page.locator(`[data-message-id="${final.id}"]`)).toHaveCount(1);
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.locator('#task-list [data-task-id]')).toHaveCount(0);
  await expect(page.locator('#activity')).toHaveText('Working');
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
  await expect(page.locator(`[data-message-id="${final.id}"]`)).toHaveCount(1);
  await page
    .locator('#task-list')
    .getByRole('button', { name: /F1 tickets/ })
    .click();
  for (const stream of streams) stream.end();
  streams.clear();
  // Updated while disconnected: snapshots must refresh both task and chat.
  taskRows[0] = {
    ...taskRows[0]!,
    status: 'completed',
    version: taskRows[0]!.version + 1,
  };
  rows = rows.map((row) =>
    row.id === final.id
      ? { ...row, version: 2, text: 'Friday tickets confirmed' }
      : row,
  );
  await expect(page.locator('#task-status')).toHaveText('completed');
  await expect(page.locator('#messages')).toContainText(
    'Friday tickets confirmed',
  );
  await expect(page.locator(`[data-message-id="${final.id}"]`)).toHaveCount(1);
  await page.screenshot({ path: 'test-results/task-chat-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const selector = page.getByRole('button', {
    name: 'Select thread: F1 tickets',
    exact: true,
  });
  const sidebar = page.getByRole('dialog', { name: 'Conversations' });
  await expect(selector).toBeVisible();
  await expect(page.locator('#thread-nav')).not.toBeVisible();
  await expect(composer).toBeInViewport();
  expect((await selector.boundingBox())!.width).toBe(
    (await page.locator('.chat-pane').boundingBox())!.width,
  );
  await selector.click();
  await expect(sidebar).toBeVisible();
  await page.screenshot({ path: 'test-results/thread-sidebar-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(sidebar).not.toBeVisible();
  await expect(selector).toBeFocused();
  await selector.click();
  await page.mouse.click(380, 300);
  await expect(sidebar).not.toBeVisible();
  await selector.click();
  await sidebar.getByRole('button', { name: 'Main', exact: true }).click();
  await expect(sidebar).not.toBeVisible();
  await expect(page.locator('#selected-thread')).toHaveText('Main');
  await expect(page.locator('#chat-title')).toHaveText('Main');
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
  await expect(sidebar).not.toBeVisible();
  await expect(page.locator('#thread-nav')).toBeVisible();
  await expect(page.locator('#thread-open')).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(selector).toBeVisible();
  await expect(page.locator('#thread-nav')).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/task-chat-mobile.png' });
  await page.reload();
  await expect(page.locator('#task-list')).toContainText('F1 tickets');
  await expect(page.locator('#messages')).toContainText(
    'Friday tickets confirmed',
  );
});

test('retries failed snapshots while SSE stays connected and cancels obsolete detail retries', async ({
  page,
}) => {
  rows = [message('Recovered history')];
  taskRows = [
    {
      id: 'retry-task',
      version: 1,
      createdAt: '2026-10-06T08:00:00.000Z',
      updatedAt: '2026-10-06T08:00:00.000Z',
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
  await expect(page.locator('#messages')).toContainText('Recovered history', {
    timeout: 12_000,
  });
  await expect(page.locator('#task-list')).toContainText('Retry task');
  expect(attempts.history).toBe(3);
  expect(attempts.tasks).toBe(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#thread-open').click();
  await page.getByRole('button', { name: /Retry task/ }).click();
  await expect(page.locator('#task-description')).toHaveText(
    'Recovered details',
    { timeout: 5000 },
  );
  expect(attempts.details).toBe(2);
  failDetails = true;
  emit('task.updated', { task: { ...taskRows[0], version: 2 } });
  await expect.poll(() => attempts.details).toBe(3);
  await page.locator('#thread-open').click();
  await page.getByRole('button', { name: 'Main', exact: true }).click();
  await expect(page.locator('#chat-title')).toHaveText('Main');
  await page.clock.install();
  await page.clock.fastForward(31_000);
  expect(attempts.details).toBe(3);
  await expect.poll(() => streams.size).toBe(1);
});

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
      uploadedFiles.set(attachment.id, attachment);
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
  const composer = page.getByRole('textbox', { name: 'Message Pal' });
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
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0].text).toBe('');
  expect(submissions[0].attachmentIds).toEqual(['uploaded-1', 'uploaded-2']);
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
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('dialog')
    .getByRole('link', { name: 'Download', exact: true })
    .click();
  expect((await downloading).suggestedFilename()).toBe('image.png');
  await page.getByRole('button', { name: 'Close image preview' }).click();
  for (const count of [1, 2, 3, 4, 5, 7]) {
    publish({
      ...message(`Grid with ${count} images`),
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
    ...message('Preview failure'),
    attachments: [fixtureAttachment('broken', 'broken.png')],
  };
  publish(broken);
  const brokenArticle = page.locator(`[data-message-id="${broken.id}"]`);
  await brokenArticle.scrollIntoViewIfNeeded();
  await expect(brokenArticle.locator('.image-cell')).toHaveAttribute(
    'data-state',
    'failed',
  );
  await expect(
    brokenArticle.getByRole('link', { name: 'Download broken.png' }),
  ).toBeVisible();
  await brokenArticle
    .getByRole('button', { name: 'Open image 1 of 1: broken.png' })
    .press('Enter');
  await expect(page.getByRole('dialog')).toContainText(
    'Image preview unavailable',
  );
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
    ...message('Loading preview'),
    attachments: [fixtureAttachment('loading', 'loading.png')],
  };
  publish(loading);
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
    ...message('Mixed attachments'),
    attachments: [fixtureAttachment('mixed', 'mixed.png'), ...documents],
  };
  publish(mixed);
  for (const count of [1, 2, 3, 4, 5, 7]) {
    const article = page
      .locator('article')
      .filter({ hasText: `Grid with ${count} images` });
    await expect(article.locator('.image-grid')).toHaveAttribute(
      'data-columns',
      String(count === 1 ? 1 : count <= 4 ? 2 : 3),
    );
    await expect(article.locator('.image-open')).toHaveCount(count);
    await article.scrollIntoViewIfNeeded();
    if (count > 1) {
      for (const cell of await article.locator('.image-open').all()) {
        const bounds = (await cell.boundingBox())!;
        expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
      }
    }
    await article.screenshot({
      path: `test-results/attachments-${count}-desktop.png`,
    });
  }
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
  await page.screenshot({
    path: 'test-results/attachments-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const count of [1, 2, 3, 4, 5, 7]) {
    const article = page
      .locator('article')
      .filter({ hasText: `Grid with ${count} images` });
    await article.scrollIntoViewIfNeeded();
    expect(
      (await article.locator('.image-grid').boundingBox())!.width,
    ).toBeLessThanOrEqual(340);
    await article.screenshot({
      path: `test-results/attachments-${count}-mobile.png`,
    });
  }
  const mobilePills = await pills.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().width),
  );
  expect(mobilePills[0]).toBe(mobilePills[1]);
  await pills.last().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'test-results/attachments-mobile.png',
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator('article.user .image-grid')).toHaveCount(1);
  await expect(
    page.locator(`[data-message-id="${mixed.id}"] .file-pill`),
  ).toHaveCount(2);
});

test('preserves selected files and destination through upload retry, chat switches, and uncertain sends', async ({
  page,
}) => {
  const task: TaskDetails = {
    id: 'file-task',
    version: 1,
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
    title: 'File task',
    goal: 'Read files',
    description: '',
    status: 'in-progress',
    archived: false,
  };
  taskRows = [task];
  const quoted = {
    ...message('Earlier file instructions'),
    taskId: task.id,
    phase: 'commentary' as const,
  };
  rows.push(quoted);
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
    uploadedFiles.set(attachment.id, attachment);
    await route.fulfill({ status: 201, json: { attachment } });
  });
  await page.goto('/');
  await page
    .locator('#task-list')
    .getByRole('button', { name: /File task/ })
    .click();
  const composer = page.getByRole('textbox', { name: 'Message Pal' });
  await page
    .locator(`[data-message-id="${quoted.id}"]`)
    .getByRole('button', { name: 'Reply to Pal’s message' })
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
  await page.getByRole('button', { name: 'Main', exact: true }).click();
  await expect(page.locator('#pending-files')).toBeHidden();
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
  failNextSend = true;
  await composer.press('Enter');
  await expect(page.locator('#send-error')).toBeVisible();
  await expect(page.locator('#pending-files')).toContainText('notes.txt');
  await expect(composer).toHaveValue('Read these notes');
  expect(submissions[0].taskId).toBe(task.id);
  expect(submissions[0].replyToMessageId).toBe(quoted.id);
  expect(submissions[0].attachmentIds).toEqual(['retried']);
  await composer.press('Enter');
  await expect(page.locator('#pending-files')).toBeHidden();
  expect(submissions[1].taskId).toBe(task.id);
  expect(submissions[1].attachmentIds).toEqual(['retried']);
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
    uploadedFiles.set(attachment.id, attachment);
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
  const composer = page.getByRole('textbox', { name: 'Message Pal' });
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
      await expect
        .poll(() =>
          scroller.evaluate((node) =>
            node.style.getPropertyValue('--fade-left'),
          ),
        )
        .toBe('0px');
      await expect
        .poll(() =>
          scroller.evaluate((node) =>
            node.style.getPropertyValue('--fade-right'),
          ),
        )
        .toBe('20px');
      await page
        .locator('.footer')
        .screenshot({ path: `test-results/pending-files-${width}-start.png` });
      await scroller.evaluate((node) => {
        node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2;
      });
      await expect
        .poll(() =>
          scroller.evaluate((node) => [
            node.style.getPropertyValue('--fade-left'),
            node.style.getPropertyValue('--fade-right'),
          ]),
        )
        .toEqual(['20px', '20px']);
      await scroller.evaluate((node) => {
        node.scrollLeft = node.scrollWidth;
      });
      await expect
        .poll(() =>
          scroller.evaluate((node) =>
            node.style.getPropertyValue('--fade-right'),
          ),
        )
        .toBe('0px');
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
    await expect.poll(() => submissions.length).toBe(1);
    expect(submissions[0].attachmentIds).toEqual([
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
  const original = { ...message('Photo', 'user'), attachments: [image] };
  rows.push(original);
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
  const answer = message('Received photo');
  publish(answer);
  publish(message('Next request', 'user'));
  publish({ ...answer, version: 2, text: 'Updated response' });
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
  taskRows = [
    {
      id: 'limit-task',
      version: 1,
      createdAt: '2026-10-08T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
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
  await page
    .locator('#task-list')
    .getByRole('button', { name: /Limit task/ })
    .click();
  await expect(page.locator('#pending-files')).toBeHidden();
  await page.getByRole('button', { name: 'Main', exact: true }).click();
  await expect(page.locator('#pending-files [role="alert"]')).toContainText(
    'at most 100 files',
  );
  await page
    .getByRole('button', { name: 'Remove notes.txt', exact: true })
    .click();
  await expect(page.locator('#pending-files')).toBeHidden();
});
