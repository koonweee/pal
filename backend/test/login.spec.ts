import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'reflect-metadata';
import { chromium, type Browser, type Page } from 'playwright-core';
import { ConfigService } from '@nestjs/config';
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
      body: `<form><input id="comment" aria-label="Comment"><input id="user" autocomplete="username" value="SECRET_USERNAME"><input id="pass" type="password" autocomplete="current-password" value="SECRET_PASSWORD"><button>Sign in</button></form><form><input id="signup" autocomplete="username"><input type="password" autocomplete="new-password"></form>`,
    }),
  );
  await page.goto('https://login.example.test/');
});
afterEach(async () => page?.close());

it('fills bound login fields, masks existing values, and never chooses comments or signup', async () => {
  const service = new LoginBrowser();
  const first = await service.inspect(page, 'task:a');
  expect(first.targets).toHaveLength(1);
  expect(first.targets[0].fields).toEqual(['username', 'password']);
  expect(JSON.stringify(first.targets)).not.toContain('SECRET');
  await page.locator('#user').fill('DIFFERENT_USERNAME');
  await page.locator('#pass').fill('DIFFERENT_PASSWORD');
  await page.locator('#pass').blur();
  const second = await service.inspect(page, 'task:a');
  expect(second.image.equals(first.image)).toBe(true);
  expect(await page.locator('[data-pal-login-mask]').count()).toBe(0);
  expect(await page.locator('[id^="pal-login-"]').count()).toBe(0);
  await expect(
    service.fill(page, 'task:b', second.targets[0].loginRef, {
      password: 'dummy',
    }),
  ).rejects.toThrow();
  await service.fill(page, 'task:a', second.targets[0].loginRef, {
    username: 'dummy-user',
    password: 'dummy-pass',
  });
  expect(await page.locator('#user').inputValue()).toBe('dummy-user');
  expect(await page.locator('#pass').inputValue()).toBe('dummy-pass');
  expect(await page.locator('#comment').inputValue()).toBe('');
  expect(await page.locator('#signup').inputValue()).toBe('');
  await page.evaluate(() => history.pushState({}, '', '/changed'));
  await expect(
    service.fill(page, 'task:a', second.targets[0].loginRef, {
      password: 'dummy',
    }),
  ).rejects.toThrow();
});
it('rejects replaced or unmasked password targets and refreshes across login stages', async () => {
  const service = new LoginBrowser();
  const inspected = await service.inspect(page, 'a');
  await page.locator('#pass').evaluate((el) => el.setAttribute('type', 'text'));
  await expect(
    service.fill(page, 'a', inspected.targets[0].loginRef, {
      password: 'dummy',
    }),
  ).rejects.toThrow();
  const revealed = await service.inspect(page, 'a');
  await page.locator('#pass').fill('DIFFERENT_REVEALED_PASSWORD');
  await page.locator('#pass').blur();
  const remasked = await service.inspect(page, 'a');
  expect(remasked.image.equals(revealed.image)).toBe(true);
  await page.setContent('<input autocomplete="username" id="first">');
  const first = await service.inspect(page, 'a');
  expect(first.targets[0].fields).toEqual(['username']);
  await service.fill(page, 'a', first.targets[0].loginRef, {
    username: 'dummy',
  });
  await page.setContent('<input type="password" id="second">');
  await expect(
    service.fill(page, 'a', first.targets[0].loginRef, { username: 'dummy' }),
  ).rejects.toThrow();
  const second = await service.inspect(page, 'a');
  expect(second.targets[0].fields).toEqual(['password']);
  await service.fill(page, 'a', second.targets[0].loginRef, {
    password: 'dummy',
  });
  expect(await page.locator('#second').inputValue()).toBe('dummy');
});
it('keeps iframe origin boundaries and rejects references after navigation', async () => {
  await page.route('https://frame.example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<input type="password">',
    }),
  );
  await page.setContent('<iframe src="https://frame.example.test/"></iframe>');
  await page.frameLocator('iframe').locator('input').waitFor();
  const service = new LoginBrowser();
  const result = await service.inspect(page, 'a');
  expect(result.targets[0].origin).toBe('https://frame.example.test');
  await page.goto('https://login.example.test/other');
  await expect(
    service.fill(page, 'a', result.targets[0].loginRef, { password: 'dummy' }),
  ).rejects.toThrow();
});

it('uses the supported vault routes, reconciles repeated saves, and sanitizes provider failures', async () => {
  const items: VaultItem[] = [];
  let server: Server;
  const seen: string[] = [];
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    seen.push(url.pathname);
    let data: unknown = {};
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
    items.push(items[0]);
    await expect(vault.matching('https://login.example.test')).rejects.toThrow(
      'Password vault is unavailable',
    );
    expect(seen.filter((path) => path === '/object/item')).toHaveLength(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('requires authentication hints for sparse username-first forms', async () => {
  const service = new LoginBrowser();
  await page.setContent(
    '<form action="/ax/claim"><input name="email" autocomplete="webauthn"><input type="password" style="display:none"><button>Continue</button></form><form><input type="email" name="email"></form>',
  );
  const result = await service.inspect(page, 'sparse');
  expect(result.targets.map((target) => target.fields)).toEqual([['username']]);
  await service.fill(page, 'sparse', result.targets[0].loginRef, {
    username: 'dummy',
  });
  expect(await page.locator('[autocomplete="webauthn"]').inputValue()).toBe(
    'dummy',
  );
  expect(await page.locator('input[type="email"]').inputValue()).toBe('');
});

it('starts and unlocks the private CLI once for concurrent callers without forwarding service secrets', async () => {
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
    if (req.url === '/status') data = {status:locked?'locked':'unlocked'};
    if (req.url === '/unlock') {
      let body=''; for await (const chunk of req) body += chunk;
      assert.equal(JSON.parse(body).password,'fixture-master'); locked=false; record('api-unlock');
    }
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
    expect(
      await Promise.all([
        vault.matching('https://example.test'),
        vault.matching('https://example.test'),
      ]),
    ).toEqual([[], []]);
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
    ]);
  } finally {
    vault.onModuleDestroy();
    await rm(root, { recursive: true, force: true });
  }
});

it('refuses declared signup, one-time-code and card-security password inputs', async () => {
  await page.setContent(
    '<form><input type="password" autocomplete="NEW-PASSWORD"></form><form><input type="password" autocomplete="one-time-code"></form><form><input type="password" autocomplete="cc-csc"></form>',
  );
  expect((await new LoginBrowser().inspect(page, 'purposes')).targets).toEqual(
    [],
  );
  await page.setContent(
    '<form><input id="otp" autocomplete="one-time-code"><input type="password"></form>',
  );
  const service = new LoginBrowser();
  const result = await service.inspect(page, 'otp');
  expect(result.targets[0].fields).toEqual(['password']);
  await service.fill(page, 'otp', result.targets[0].loginRef, {
    username: 'dummy',
    password: 'dummy',
  });
  expect(await page.locator('#otp').inputValue()).toBe('');
});
