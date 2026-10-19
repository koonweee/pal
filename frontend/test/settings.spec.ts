import { expect, test } from '@playwright/test';
import type { McpServer, McpSnapshot } from '../src/api/client';
import { usePalBackend } from './support/pal-backend';

usePalBackend(test);

test('configures MCP, hands OAuth to the browser, and shows busy Apply and connection errors', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  await page.getByRole('button', { name: 'Preferences' }).click();
  const settings = page.getByRole('dialog', { name: 'Preferences' });
  await settings.getByRole('tab', { name: 'Connections' }).click();
  await expect(settings.getByText('No servers configured')).toBeVisible();
  await expect(settings.getByLabel(/^Name/)).not.toBeVisible();
  await settings
    .getByRole('button', { name: 'Add server', exact: true })
    .click();
  await settings.getByLabel(/^Name/).fill('research');
  await settings.getByLabel('Server URL').fill('https://example.com/mcp');
  await settings
    .getByLabel('Authentication', { exact: true })
    .selectOption('oauth');
  await settings.getByLabel(/^Client ID/).fill('pal-client');
  await settings
    .getByLabel('Client secret', { exact: true })
    .fill('private-secret');
  await settings
    .getByLabel('Scopes')
    .fill('service:read service:write offline_access');
  await expect(settings.getByLabel(/^Client metadata URL/)).not.toBeVisible();
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
  await settings.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(
    settings.getByLabel('Client secret', { exact: true }),
  ).toHaveValue('');
  await expect(settings.getByLabel(/^Name/)).toBeDisabled();
  await settings.getByLabel('Client identity').selectOption('metadata');
  await expect(settings.getByLabel(/^Client ID/)).not.toBeVisible();
  await settings
    .getByLabel(/^Client metadata URL/)
    .fill('https://identity.example/client.json');
  await settings
    .getByRole('button', { name: 'Save server', exact: true })
    .click();
  await expect(settings.getByLabel(/^Name/)).not.toBeVisible();
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
    .getByRole('menuitem', { name: 'Remove server', exact: true })
    .click();
  await expect(
    settings.getByText(
      'Remove research? Its loaded connection remains until you apply changes.',
    ),
  ).toBeVisible();
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(settings.getByText('research', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Close preferences' }).click();
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
  await page.getByRole('button', { name: 'Preferences' }).click();
  const settings = page.getByRole('dialog', { name: 'Preferences' });
  await settings.getByRole('tab', { name: 'Connections' }).click();
  const edit = async () => {
    await settings.getByText('Manage', { exact: true }).click();
    await settings.getByRole('menuitem', { name: 'Edit', exact: true }).click();
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
  await expect(settings.getByLabel(/^Name/)).toBeFocused();
  await settings.getByLabel(/^Name/).fill('token');
  await settings.getByLabel('Server URL').fill('https://example.com/token');
  await settings.getByLabel('Authentication').selectOption('bearer');
  await settings.getByLabel(/^Bearer token/).fill('fixture-token');
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
