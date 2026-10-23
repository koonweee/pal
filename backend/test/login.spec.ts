import { normalizeFields } from '../dist/login/login-fields.js';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'reflect-metadata';
import { chromium, type Browser, type Page } from 'playwright-core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import { LoginBrowser } from '../dist/login/login-browser.js';
import {
  BitwardenService,
  type VaultItem,
} from '../dist/login/bitwarden.service.js';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({
    channel: 'chrome',
    executablePath: process.env.TEST_CHROMIUM_PATH,
    headless: true,
  });
});
afterAll(async () => browser?.close());
beforeEach(async () => {
  page = await browser.newPage();
  await page.route('https://login.example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<form><input id="comment" aria-label="Comment"><input id="user" aria-label="Username" autocomplete="username" value="SECRET_USERNAME"><input id="pass" aria-label="Password" type="password" autocomplete="current-password" value="SECRET_PASSWORD"><button>Sign in</button></form><form><input id="signup" aria-label="Signup username" autocomplete="username"><input aria-label="Signup password" type="password" autocomplete="new-password"></form>`,
    }),
  );
  await page.goto('https://login.example.test/');
});
afterEach(async () => page?.close());

it('accepts null optional roles and distinguishes malformed selections from stale references', async () => {
  const service = new LoginBrowser();
  const inspection = await service.inspect(page, 'a');
  const fields = normalizeFields({
    username: inspection.inputs[1].ref,
    password: null,
    code: null,
  });
  expect(fields).toEqual({ username: inspection.inputs[1].ref });
  expect(
    normalizeFields({ username: null, password: null, code: ['code-ref'] }),
  ).toEqual({ code: ['code-ref'] });
  await expect(
    service.fill(page, 'a', fields, { username: 'dummy' }),
  ).resolves.toMatchObject({ status: 'filled' });
  for (const invalid of [
    { username: null, password: null },
    { username: 42 },
    { username: 'a', code: ['b'] },
    { username: 'a', password: 'a' },
    { username: 'a', extra: null },
  ]) {
    try {
      normalizeFields(invalid);
      throw new Error('Expected invalid selection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_input' });
    }
  }
  await expect(
    service.select(page, 'a', { username: 'missing-ref' }),
  ).rejects.toMatchObject({ code: 'conflict' });
});

it('extracts generic masked inputs and fills only explicitly assigned credential roles', async () => {
  const service = new LoginBrowser();
  const first = await service.inspect(page, 'a');
  expect(first.inputs.map((i) => i.label)).toEqual([
    'Comment',
    'Username',
    'Password',
    'Signup username',
    'Signup password',
  ]);
  expect(first.inputs[0].group).toBe(first.inputs[1].group);
  expect(first.inputs[3].group).not.toBe(first.inputs[1].group);
  expect(JSON.stringify(first.inputs)).not.toContain('SECRET');
  expect(first).not.toHaveProperty('targets');
  await page.locator('#comment').fill('SECRET_COMMENT');
  await page.locator('#user').fill('DIFFERENT_USERNAME');
  await page.locator('#pass').fill('DIFFERENT_PASSWORD');
  await page.locator('#pass').blur();
  const second = await service.inspect(page, 'a');
  expect(second.image.equals(first.image)).toBe(true);
  const fields = {
    username: second.inputs[1].ref,
    password: second.inputs[2].ref,
  };
  await expect(
    service.fill(page, 'other', fields, {
      username: 'dummy',
      password: 'dummy',
    }),
  ).rejects.toThrow(/selection/);
  expect(
    await service.fill(page, 'a', fields, {
      username: 'dummy-user',
      password: 'dummy-pass',
    }),
  ).toEqual({ status: 'filled', fields: ['username', 'password'] });
  expect(await page.locator('#user').inputValue()).toBe('dummy-user');
  expect(await page.locator('#pass').inputValue()).toBe('dummy-pass');
  expect(await page.locator('#signup').inputValue()).toBe('');
  expect(await page.locator('#comment').inputValue()).toBe('SECRET_COMMENT');
  await page.locator('#user').fill('');
  for (const invalid of [
    { username: fields.username, password: second.inputs[0].ref },
    { username: fields.username, password: fields.username },
    { password: second.inputs[4].ref },
    {},
  ]) {
    await expect(
      service.fill(page, 'a', invalid, {
        username: 'dummy',
        password: 'PRIVATE_VALUE',
      }),
    ).rejects.toThrow(/selection/);
    expect(await page.locator('#user').inputValue()).toBe('');
  }
  await page.locator('#pass').evaluate((el) => (el.type = 'text'));
  await expect(
    service.fill(page, 'a', fields, {
      username: 'dummy',
      password: 'PRIVATE_VALUE',
    }),
  ).rejects.toThrow(/selection/);
  await page.locator('#user').blur();
  const revealed = await service.inspect(page, 'a');
  await page.locator('#pass').fill('OTHER_REVEALED_SECRET');
  await page.locator('#pass').blur();
  expect((await service.inspect(page, 'a')).image.equals(revealed.image)).toBe(
    true,
  );
  await expect(
    service.fill(page, 'a', fields, { password: 'dummy' }),
  ).rejects.toThrow(/selection/);
});

it('accepts unlabelled and non-English fields and preserves model-selected code order', async () => {
  const service = new LoginBrowser();
  await page.setContent(
    '<input id="user" aria-label="账号"><div id="collapsed" style="height:0;overflow:hidden"><input id="pass" type="password"></div><input readonly value="PRIVATE_READONLY"><input type="checkbox">',
  );
  const first = await service.inspect(page, 'a');
  expect(first.inputs.map((i) => i.label)).toEqual(['账号']);
  await service.fill(
    page,
    'a',
    { username: first.inputs[0].ref },
    { username: 'dummy' },
  );
  await page.locator('#collapsed').evaluate((el) => (el.style.height = 'auto'));
  const next = await service.inspect(page, 'a');
  expect(next.inputs).toHaveLength(2);
  await page.locator('#collapsed').evaluate((el) => (el.style.height = '0'));
  await expect(
    service.fill(
      page,
      'a',
      { password: next.inputs[1].ref },
      { password: 'dummy' },
    ),
  ).rejects.toThrow(/selection/);
  await page.setContent(
    '<input id="single" aria-label="输入"><input aria-label="Comment">',
  );
  const single = await service.inspect(page, 'a');
  await service.fill(
    page,
    'a',
    { code: [single.inputs[0].ref] },
    { code: 'Ab7319' },
  );
  expect(await page.locator('#single').inputValue()).toBe('Ab7319');
  expect(await page.locator('input').nth(1).inputValue()).toBe('');
  await page.locator('#single').blur();
  expect((await service.inspect(page, 'a')).image.equals(single.image)).toBe(
    true,
  );
  await page.setContent(
    '<input aria-label="C" maxlength="1"><input aria-label="A" maxlength="1"><input aria-label="B" maxlength="1">',
  );
  const split = await service.inspect(page, 'a');
  const fields = {
    code: [split.inputs[1].ref, split.inputs[2].ref, split.inputs[0].ref],
  };
  await expect(service.fill(page, 'a', fields, { code: 'AB' })).rejects.toThrow(
    /complete/,
  );
  expect(
    await page
      .locator('input')
      .evaluateAll((es) => es.every((e) => e.value === '')),
  ).toBe(true);
  await expect(
    service.fill(
      page,
      'a',
      { code: [split.inputs[0].ref, split.inputs[0].ref] },
      { code: 'AB' },
    ),
  ).rejects.toThrow(/selection/);
  await page
    .locator('input')
    .nth(0)
    .evaluate((el) => (el.autocomplete = 'cc-csc'));
  await expect(
    service.fill(page, 'a', fields, { code: 'Ab3' }),
  ).rejects.toThrow(/selection/);
  expect(await page.locator('input').nth(1).inputValue()).toBe('');
  await page
    .locator('input')
    .nth(0)
    .evaluate((el) => (el.autocomplete = 'off'));
  expect(
    (await service.fill(page, 'a', fields, { code: 'Ab3' })).fields,
  ).toEqual(['code']);
  expect(
    await page.locator('input').evaluateAll((es) => es.map((e) => e.value)),
  ).toEqual(['3', 'A', 'b']);
  await expect(
    service.select(page, 'a', {
      ...fields,
      username: split.inputs[0].ref,
    } as never),
  ).rejects.toThrow(/selection/);
});

it('refuses mixed frames, replaced elements and changed documents or URLs', async () => {
  await page.route('https://frame.example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<input type="password" aria-label="Frame password">',
    }),
  );
  await page.setContent(
    '<input aria-label="Main username"><iframe src="https://frame.example.test/a"></iframe><iframe src="https://frame.example.test/b"></iframe>',
  );
  await page.frameLocator('iframe').first().locator('input').waitFor();
  await page.frameLocator('iframe').nth(1).locator('input').waitFor();
  const service = new LoginBrowser();
  const first = await service.inspect(page, 'a');
  expect(first.inputs).toHaveLength(3);
  expect(first.inputs[1].origin).toBe('https://frame.example.test');
  await expect(
    service.fill(
      page,
      'a',
      { username: first.inputs[0].ref, password: first.inputs[1].ref },
      { username: 'dummy', password: 'dummy' },
    ),
  ).rejects.toThrow(/selection/);
  await expect(
    service.fill(
      page,
      'a',
      { code: [first.inputs[1].ref, first.inputs[2].ref] },
      { code: '12' },
    ),
  ).rejects.toThrow(/selection/);
  await service.fill(
    page,
    'a',
    { password: first.inputs[1].ref },
    { password: 'dummy' },
  );
  expect(
    await page.frameLocator('iframe').nth(1).locator('input').inputValue(),
  ).toBe('');
  await page.frames()[1].evaluate(() => history.pushState({}, '', '/changed'));
  await expect(
    service.fill(
      page,
      'a',
      { password: first.inputs[1].ref },
      { password: 'dummy' },
    ),
  ).rejects.toThrow(/selection/);
  await page.setContent('<input id="original">');
  const next = await service.inspect(page, 'a');
  await page
    .locator('#original')
    .evaluate((el) => (el.outerHTML = '<input id="replacement">'));
  await expect(
    service.fill(
      page,
      'a',
      { username: next.inputs[0].ref },
      { username: 'dummy' },
    ),
  ).rejects.toThrow(/selection/);
  await page.goto('https://login.example.test/other');
  await expect(
    service.fill(
      page,
      'a',
      { username: next.inputs[0].ref },
      { username: 'dummy' },
    ),
  ).rejects.toThrow(/selection/);
});

it('expires refs and rejects readonly destinations before writing any credential', async () => {
  const service = new LoginBrowser();
  const result = await service.inspect(page, 'a');
  const fields = {
    username: result.inputs[1].ref,
    password: result.inputs[2].ref,
  };
  await page.locator('#pass').evaluate((el) => (el.readOnly = true));
  await expect(
    service.fill(page, 'a', fields, { username: 'dummy', password: 'dummy' }),
  ).rejects.toThrow(/selection/);
  expect(await page.locator('#user').inputValue()).toBe('SECRET_USERNAME');
  const time = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600001);
  try {
    await expect(
      service.select(page, 'a', { username: fields.username }),
    ).rejects.toThrow(/selection/);
  } finally {
    time.mockRestore();
  }
});

it('uses the supported vault routes, reconciles repeated saves, and sanitizes provider failures', async () => {
  const items: VaultItem[] = [];
  let server: Server;
  const seen: string[] = [];
  let failList = false;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    seen.push(url.pathname);
    let data: unknown = {};
    if (url.pathname === '/list/object/items' && failList) {
      res.writeHead(500);
      res.end('SECRET_PROVIDER_ERROR');
      return;
    }
    if (url.pathname === '/list/object/items') {
      expect(url.searchParams.get('url')).toBe('https://login.example.test');
      data = { data: items };
    }
    if (url.pathname === '/object/item') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const item = { ...JSON.parse(body), id: 'fixture-account' };
      items.push(item);
      data = item;
    }
    if (
      url.pathname === '/object/item/fixture-account' &&
      req.method === 'PUT'
    ) {
      let body = '';
      for await (const chunk of req) body += chunk;
      items[0] = JSON.parse(body);
      data = items[0];
    }
    if (url.pathname === '/sync' && items.length > 1) {
      res.writeHead(500);
      res.end('SECRET_PROVIDER_ERROR');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true, data }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  class FixtureVault extends BitwardenService {
    protected get endpoint() {
      return 'http://127.0.0.1:' + address.port;
    }
    protected async ensureReady() {}
  }
  const vault = new FixtureVault(new ConfigService());
  try {
    const input = {
      username: 'dummy',
      password: 'dummy-pass',
      label: 'Personal',
    };
    expect(
      await vault.save('https://login.example.test', input, 'request-a'),
    ).toBe('fixture-account');
    expect(
      await vault.save('https://login.example.test', input, 'request-a'),
    ).toBe('fixture-account');
    expect(items).toHaveLength(1);
    expect(items[0].login!.uris![0].match).toBe(1);
    expect(
      await vault.save(
        'https://login.example.test',
        { ...input, accountId: 'fixture-account', password: 'updated-dummy' },
        'request-b',
      ),
    ).toBe('fixture-account');
    expect(items).toHaveLength(1);
    expect(items[0].login!.password).toBe('updated-dummy');
    await expect(
      new BitwardenService(new ConfigService()).matching(
        'https://login.example.test',
      ),
    ).rejects.toThrow('Password vault needs configuration');
    expect(seen.filter((path) => path === '/sync')).toHaveLength(1);
    expect(
      (await vault.matching('https://login.example.test'))[0].login!.password,
    ).toBe('updated-dummy');
    items.push(items[0]);
    // The hourly refresh can fail while cached vault reads remain available.
    await vi.advanceTimersByTimeAsync(3600_000);
    await vi.waitFor(() =>
      expect(seen.filter((path) => path === '/sync')).toHaveLength(2),
    );
    expect(await vault.matching('https://login.example.test')).toHaveLength(2);
    failList = true;
    await expect(vault.matching('https://login.example.test')).rejects.toThrow(
      'Password vault is unavailable',
    );
    expect(seen.filter((path) => path === '/object/item')).toHaveLength(1);
  } finally {
    vault.onModuleDestroy();
    vi.useRealTimers();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('prewarms the private CLI before concurrent lookups without forwarding service secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pal-vault-'));
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const binary = join(root, 'fixture-bw');
  const events = join(root, 'events.jsonl');
  await writeFile(
    binary,
    `#!${process.execPath}
import {appendFileSync} from 'node:fs';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const args = process.argv.slice(2), command = args[0];
const record = label => appendFileSync(${JSON.stringify(events)}, JSON.stringify(label)+'\\n');
assert.equal(process.env.HOME, ${JSON.stringify(join(root, 'bitwarden'))});
assert.equal(process.env.TMPDIR, process.env.HOME + '/tmp');
assert.equal(process.env.BITWARDENCLI_APPDATA_DIR, process.env.HOME);
assert.equal(process.env.DATABASE_URL, undefined);
record(command);
if (command === 'status') process.stdout.write(JSON.stringify({status:'unauthenticated'}));
if (command === 'login') { assert.equal(process.env.BW_CLIENTID,'fixture-id'); assert.equal(process.env.BW_CLIENTSECRET,'fixture-key'); }
if (command === 'unlock') { assert.equal(process.env.PAL_VAULT_PASSWORD,'fixture-master'); process.stdout.write('fixture-session'); }
if (command === 'serve') {
  assert.equal(process.env.BW_SESSION,'fixture-session');
  assert.equal(process.env.PAL_VAULT_PASSWORD,undefined);
  assert.deepEqual(args.slice(1), ['--hostname','127.0.0.1','--port','8087']);
  let locked = true;
  const server = createServer(async (req,res) => {
    let data = {};
    if (req.url === '/status') data = {object:'template',template:{status:locked?'locked':'unlocked'}};
    if (req.url === '/unlock') {
      let body=''; for await (const chunk of req) body += chunk;
      assert.equal(JSON.parse(body).password,'fixture-master'); locked=false; record('api-unlock');
    }
    if (req.url === '/sync') record('api-sync');
    if (req.url.startsWith('/list/object/items')) data = {data:[]};
    res.setHeader('content-type','application/json');res.end(JSON.stringify({success:true,data}));
  });
  server.listen(${port},'127.0.0.1');
  process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
}
`,
    { mode: 0o700 },
  );
  class FixtureProcessVault extends BitwardenService {
    protected get endpoint() {
      return 'http://127.0.0.1:' + port;
    }
  }
  const vault = new FixtureProcessVault(
    new ConfigService({
      PAL_UPLOAD_DIR: join(root, 'uploads'),
      PAL_BITWARDEN_CLI: binary,
      PAL_BITWARDEN_CLIENT_ID: 'fixture-id',
      PAL_BITWARDEN_CLIENT_SECRET: 'fixture-key',
      PAL_BITWARDEN_MASTER_PASSWORD: 'fixture-master',
    }),
  );
  try {
    expect(vault.onModuleInit()).toBeUndefined();
    await vi.waitFor(async () => {
      expect(await readFile(events, 'utf8')).toContain('api-sync');
    });
    expect(
      await Promise.all([
        vault.matching('https://example.test'),
        vault.matching('https://example.test'),
      ]),
    ).toEqual([[], []]);
    await vault.matching('https://example.test');
    const labels = (await readFile(events, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(labels).toEqual([
      'status',
      'login',
      'unlock',
      'serve',
      'api-unlock',
      'api-sync',
    ]);
  } finally {
    vault.onModuleDestroy();
    await rm(root, { recursive: true, force: true });
  }
});

it('skips unconfigured prewarming and retries a sanitized startup failure on demand', async () => {
  let attempts = 0;
  const routes: string[] = [];
  class FixtureVault extends BitwardenService {
    protected async ensureReady() {
      if (++attempts === 1) throw new Error('SECRET_PROVIDER_ERROR');
    }
    protected async request<T>(path: string): Promise<T> {
      routes.push(path);
      return { data: [] } as T;
    }
  }
  const warning = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => {});
  const unconfigured = new FixtureVault(new ConfigService());
  const configured = new FixtureVault(
    new ConfigService({
      PAL_BITWARDEN_CLIENT_ID: 'fixture-id',
      PAL_BITWARDEN_CLIENT_SECRET: 'fixture-key',
      PAL_BITWARDEN_MASTER_PASSWORD: 'fixture-master',
    }),
  );
  try {
    expect(unconfigured.onModuleInit()).toBeUndefined();
    expect(attempts).toBe(0);
    expect(configured.onModuleInit()).toBeUndefined();
    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        'Password vault prewarming failed; login requests will retry',
      ),
    );
    expect(routes).toEqual([]);
    expect(await configured.matching('https://example.test')).toEqual([]);
    expect(attempts).toBe(2);
    expect(routes).toEqual([
      '/sync',
      '/list/object/items?url=https%3A%2F%2Fexample.test',
    ]);
  } finally {
    unconfigured.onModuleDestroy();
    configured.onModuleDestroy();
    warning.mockRestore();
  }
});
