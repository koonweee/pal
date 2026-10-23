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
      body: '<form><input autocomplete="username" id="user"><button>Next</button></form><textarea id="comment"></textarea>',
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
  const configured = vi.spyOn(vault, 'configured', 'get').mockReturnValue(true);
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
    expect(inspection.targets[0].fields).toEqual(['username']);
    const preview = await request(fixture.url)
      .get('/login/inspections/' + inspection.inspectionId + '/image')
      .expect(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.headers['content-type']).toContain('image/png');
    const pending = await login.request(
      task.id,
      inspection.targets[0].targetRef,
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
    expect(
      (await login.request(task.id, fresh.targets[0].targetRef)).status,
    ).toBe('credentials_available');
    outputs.push(await login.fill(task.id, fresh.targets[0].targetRef));
    expect(await page.locator('#user').inputValue()).toBe(
      'SYNTHETIC_PRIVATE_USER',
    );
    await page.setContent(
      '<form><input id="pass" type="password" autocomplete="current-password"></form><textarea id="comment"></textarea>',
    );
    const passwordStage = await login.inspect(task.id);
    expect(
      (await login.request(task.id, passwordStage.targets[0].targetRef)).status,
    ).toBe('credentials_available');
    expect(
      (await login.snapshot(task.id)).requests.filter(
        (r) => r.status === 'pending',
      ),
    ).toHaveLength(0);
    outputs.push(await login.fill(task.id, passwordStage.targets[0].targetRef));
    expect(await page.locator('#pass').inputValue()).toBe(
      'SYNTHETIC_PRIVATE_PASSWORD',
    );
    // Once tried, replacement remains available for a rejected saved password.
    const replacement = await login.request(
      task.id,
      passwordStage.targets[0].targetRef,
    );
    expect(replacement.status).toBe('awaiting_user');
    await login.finish(replacement.requestId!);
    expect(await page.locator('#comment').inputValue()).toBe('');
    expect(JSON.stringify({ outputs, notifications })).not.toContain(
      'SYNTHETIC_PRIVATE',
    );
    await page.setContent(
      '<form>' +
        Array.from(
          { length: 6 },
          (_, i) =>
            `<input type="tel" aria-label="Verification Code Digit ${i + 1}">`,
        ).join('') +
        '</form>',
    );
    const otp = await login.inspect(task.id);
    expect(otp.targets[0].fields).toEqual(['code']);
    expect((await login.fill(task.id, otp.targets[0].targetRef)).status).toBe(
      'input_required',
    );
    const codeRequest = await login.request(task.id, otp.targets[0].targetRef);
    expect(codeRequest.kind).toBe('code');
    const snapshot = (
      await request(fixture.url).get(`/login/tasks/${task.id}`).expect(200)
    ).body;
    expect(snapshot.inspections).toHaveLength(1);
    expect(snapshot.requests[0].kind).toBe('code');
    const code = '731946';
    const first = await request(fixture.url)
      .post(`/login/requests/${codeRequest.requestId}/code`)
      .send({ code })
      .expect(201);
    outputs.push(first.body);
    expect(first.body.status).toBe('filled');
    expect(
      await page
        .locator('input')
        .evaluateAll((es) => es.map((e) => e.value).join('')),
    ).toBe(code);
    await page
      .locator('input')
      .evaluateAll((es) => es.forEach((e) => (e.value = '')));
    await request(fixture.url)
      .post(`/login/requests/${codeRequest.requestId}/code`)
      .send({ code })
      .expect(201);
    expect(
      await page
        .locator('input')
        .evaluateAll((es) => es.every((e) => e.value === '')),
    ).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    const staleRequest = await login.request(task.id, otp.targets[0].targetRef);
    await page.goto('https://example.test/other');
    const stale = await request(fixture.url)
      .post(`/login/requests/${staleRequest.requestId}/code`)
      .send({ code })
      .expect(409);
    expect(JSON.stringify(stale.body)).not.toContain(code);
    await fixture.database.pool.query(
      "update login_requests set created_at=now()-interval '11 minutes' where id=$1",
      [staleRequest.requestId],
    );
    await request(fixture.url)
      .post(`/login/requests/${staleRequest.requestId}/code`)
      .send({ code })
      .expect(409);
    await login.flushNotifications();
    expect(
      (await login.snapshot(task.id)).requests.find(
        (r) => r.id === staleRequest.requestId,
      )?.status,
    ).toBe('cancelled');
    expect(JSON.stringify({ outputs, notifications })).not.toContain(code);
    const persisted = await fixture.database.pool.query(
      'select row_to_json(r) as value from login_requests r union all select row_to_json(i) from login_inspections i',
    );
    expect(JSON.stringify(persisted.rows)).not.toContain('SYNTHETIC_PRIVATE');
    expect(JSON.stringify(persisted.rows)).not.toContain(code);
  } finally {
    subscription.unsubscribe();
    login.onModuleDestroy();
    selected.mockRestore();
    matching.mockRestore();
    save.mockRestore();
    configured.mockRestore();
    await browser.close();
  }
});
