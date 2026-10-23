import { chromium } from 'playwright-core';
import { BrowserService } from '../dist/browser/browser.service.js';
import { LoginService } from '../dist/login/login.service.js';
import { EventsService } from '../dist/events/events.service.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startTestApp, until } from './helpers.js';
import { LoginRepository } from '../dist/login/login.repository.js';
import { BitwardenService } from '../dist/login/bitwarden.service.js';
let fixture: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  fixture = await startTestApp();
});
afterAll(async () => fixture?.close());
beforeEach(async () => fixture.reset());
it('keeps request metadata secret-free and saves once across repeated API submissions', async () => {
  const task = await fixture.app
    .get(TasksService)
    .create({ title: 'Login fixture', goal: 'Verify login' });
  const repository = fixture.app.get(LoginRepository);
  const vault = fixture.app.get(BitwardenService);
  const save = vi.spyOn(vault, 'save').mockResolvedValue(randomUUID());
  const pending = await repository.request(task.id, 'https://example.com');
  expect((await repository.request(task.id, 'https://example.com')).id).toBe(
    pending.id,
  );
  const input = {
    username: 'SENTINEL_USER',
    password: 'SENTINEL_PASSWORD',
    label: 'Personal',
  };
  await request(fixture.url)
    .post(`/login/requests/${pending.id}/save`)
    .send(input)
    .expect(201);
  await request(fixture.url)
    .post(`/login/requests/${pending.id}/save`)
    .send(input)
    .expect(201);
  expect(save).toHaveBeenCalledTimes(1);
  const snapshot = (
    await request(fixture.url).get(`/login/tasks/${task.id}`).expect(200)
  ).body;
  expect(snapshot.requests[0].status).toBe('saved');
  expect(JSON.stringify(snapshot)).not.toContain('SENTINEL');
  const row = (
    await fixture.database.pool.query(
      'select * from login_requests where id=$1',
      [pending.id],
    )
  ).rows[0];
  expect(JSON.stringify(row)).not.toContain('SENTINEL');
  const next = await repository.request(task.id, 'https://example.com');
  await request(fixture.url)
    .post(`/login/requests/${next.id}/cancel`)
    .expect(201);
  expect(save).toHaveBeenCalledTimes(1);
  save.mockRestore();
});

it('connects inspection, direct PWA save, retryable task notification, and browser fill without returning secrets', async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    executablePath: process.env.TEST_CHROMIUM_PATH,
    headless: true,
  });
  const task = await fixture.app
    .get(TasksService)
    .create({ title: 'Synthetic login', goal: 'Verify private filling' });
  const login = fixture.app.get(LoginService);
  const vault = fixture.app.get(BitwardenService);
  const page = await browser.newPage();
  await page.route('https://example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<form><input autocomplete="username" id="user"><input type="password" id="pass"><button>Sign in</button></form><textarea id="comment"></textarea>',
    }),
  );
  await page.goto('https://example.test/login');
  const selected = vi
    .spyOn(fixture.app.get(BrowserService), 'selectedPage')
    .mockResolvedValue(page);
  let item:
    | {
        id: string;
        name: string;
        type: number;
        login: { username: string; password: string };
      }
    | undefined;
  const matching = vi
    .spyOn(vault, 'matching')
    .mockImplementation(async () => (item ? [structuredClone(item)] : []));
  const save = vi
    .spyOn(vault, 'save')
    .mockImplementation(async (_origin, input) => {
      item = {
        id: randomUUID(),
        name: input.label,
        type: 1,
        login: { username: input.username, password: input.password },
      };
      return item.id;
    });
  const outputs: unknown[] = [];
  const notifications: string[] = [];
  let deliver = false;
  login.bindNotifier(async (_id, text) => {
    if (!deliver) throw new Error('Temporary delivery failure');
    notifications.push(text);
  });
  const subscription = fixture.app
    .get(EventsService)
    .changes.subscribe((event) => outputs.push(event));
  try {
    const inspection = await login.inspect(task.id);
    outputs.push(inspection);
    expect(inspection.targets[0].fields).toEqual(['username', 'password']);
    const preview = await request(fixture.url)
      .get('/login/inspections/' + inspection.inspectionId + '/image')
      .expect(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.headers['content-type']).toContain('image/png');
    const pending = await login.request(
      task.id,
      inspection.targets[0].loginRef,
    );
    outputs.push(pending);
    expect((await fixture.app.get(TasksService).details(task.id)).status).toBe(
      'needs-input',
    );
    const result = await request(fixture.url)
      .post('/login/requests/' + pending.requestId + '/save')
      .send({
        username: 'SYNTHETIC_PRIVATE_USER',
        password: 'SYNTHETIC_PRIVATE_PASSWORD',
        label: 'Personal',
      })
      .expect(201);
    outputs.push(result.body);
    // Save succeeded even though the task delivery failed; recovery only retries notification.
    await login.flushNotifications();
    deliver = true;
    await until(async () => {
      await login.flushNotifications();
      return notifications.length === 1;
    });
    expect(notifications).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
    const fresh = await login.inspect(task.id);
    outputs.push(fresh);
    outputs.push(await login.fill(task.id, fresh.targets[0].loginRef));
    expect(await page.locator('#user').inputValue()).toBe(
      'SYNTHETIC_PRIVATE_USER',
    );
    expect(await page.locator('#pass').inputValue()).toBe(
      'SYNTHETIC_PRIVATE_PASSWORD',
    );
    expect(await page.locator('#comment').inputValue()).toBe('');
    expect(JSON.stringify({ outputs, notifications })).not.toContain(
      'SYNTHETIC_PRIVATE',
    );
    const persisted = await fixture.database.pool.query(
      'select row_to_json(r) as value from login_requests r union all select row_to_json(i) from login_inspections i',
    );
    expect(JSON.stringify(persisted.rows)).not.toContain('SYNTHETIC_PRIVATE');
  } finally {
    subscription.unsubscribe();
    login.onModuleDestroy();
    selected.mockRestore();
    matching.mockRestore();
    save.mockRestore();
    await browser.close();
  }
});
