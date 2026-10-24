import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
} from '@mastra/core/request-context';
import { noopObserve } from '@mastra/core/tools';
import { PARENT_TASK_ID, WORKER_ID } from '../dist/agent/task-workers.js';
import { loginTools } from '../dist/login/login-tools.js';
import type { SecureFields } from '../dist/login/login-fields.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { chromium } from 'playwright-core';
import { BrowserService } from '../dist/browser/browser.service.js';
import { LoginService } from '../dist/login/login.service.js';
import { EventsService } from '../dist/events/events.service.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
    .post(`/login/requests/${pending.id}/select`)
    .send({ accountId: randomUUID() })
    .expect(400);
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
    await request(fixture.url).get(`/login/requests/${pending.id}`).expect(200)
  ).body;
  expect(snapshot.status).toBe('saved');
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

it('retains secure-entry sessions across fresh worker assignments and cancels interrupted entry', async () => {
  const task = await fixture.app.get(TasksService).create({
    title: 'Interaction continuation',
    goal: 'Resume secure entry',
  });
  const repository = fixture.app.get(LoginRepository);
  const login = fixture.app.get(LoginService);
  const workerId = randomUUID();
  const pending = await repository.request(
    task.id,
    'https://resume.example.test',
    'credentials',
    undefined,
    workerId,
  );
  const groups = vi
    .spyOn(fixture.app.get(BrowserService), 'groups')
    .mockResolvedValue([
      {
        taskId: task.id,
        groupId: 1,
        lastActivity: Date.now(),
        sessions: ['worker-' + workerId],
        tabs: [],
      },
    ]);
  try {
    expect(await login.retainWorkerSession(task.id, workerId, true, 0)).toBe(
      true,
    );
    const assignment =
      'Continue secure entry request ' +
      pending.id +
      '. Submit the form and report the outcome.';
    expect(await login.resumeWorker(task.id, assignment)).toBe(workerId);
    expect(await login.resumeWorker(randomUUID(), assignment)).toBeUndefined();
    expect(
      await login.resumeWorker(task.id, 'secure entry request ' + randomUUID()),
    ).toBeUndefined();
    groups.mockResolvedValueOnce([]);
    expect(await login.resumeWorker(task.id, assignment)).toBeUndefined();
    expect(await login.retainWorkerSession(task.id, workerId, false, 0)).toBe(
      false,
    );
    expect((await repository.get(pending.id)).status).toBe('cancelled');
    expect(await login.resumeWorker(task.id, assignment)).toBeUndefined();
    expect(await login.retainWorkerSession(task.id, workerId, true, 0)).toBe(
      false,
    );
    const submitted = await repository.request(
      task.id,
      'https://resume.example.test',
      'credentials',
      undefined,
      workerId,
    );
    await repository.finish(submitted.id, {
      kind: 'credentials',
      status: 'filled',
      submit: async () => ({ filled: true }),
    });
    expect(
      await login.retainWorkerSession(
        task.id,
        workerId,
        true,
        submitted.createdAt.getTime(),
      ),
    ).toBe(true);
    expect(
      await login.retainWorkerSession(
        task.id,
        workerId,
        true,
        submitted.createdAt.getTime() + 1,
      ),
    ).toBe(false);
  } finally {
    groups.mockRestore();
  }
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
  const items: {
    id: string;
    name: string;
    type: number;
    login: { username: string; password: string };
  }[] = [];
  const matching = vi
    .spyOn(vault, 'matching')
    .mockImplementation(async () => structuredClone(items));
  const configured = vi.spyOn(vault, 'configured', 'get').mockReturnValue(true);
  const save = vi
    .spyOn(vault, 'save')
    .mockImplementation(async (_origin, input) => {
      const item = {
        id: randomUUID(),
        name: input.label,
        type: 1,
        login: { username: input.username, password: input.password },
      };
      items.push(item);
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
    expect(inspection.inputs[0].autocomplete).toBe('username');
    const preview = await request(fixture.url)
      .get('/login/inspections/' + inspection.inspectionId + '/image')
      .expect(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.headers['content-type']).toContain('image/png');
    const pending = await loginTools(login).secure_entry_request.execute!(
      {
        fields: {
          username: inspection.inputs[0].ref,
          password: null,
          code: null,
        } as unknown as SecureFields,
        chooseAccount: true,
      },
      {
        requestContext: new RequestContext([
          [MASTRA_THREAD_ID_KEY, 'pal-task:' + task.id],
        ]),
        observe: noopObserve,
      },
    );
    if (!('requestId' in pending))
      throw new Error('Expected secure entry request');
    expect(pending).toMatchObject({ chooseAccount: false }); // No saved accounts: open entry directly.
    outputs.push(pending);
    const chat = fixture.app.get(ChatService);
    const card = (await chat.history({ taskId: task.id })).messages.find(
      (m) => m.metadata.secureEntryRequestId === pending.requestId,
    )!;
    expect(card).toMatchObject({ taskId: task.id, mainVisible: true });
    expect((await chat.history({})).messages).toContainEqual(card);
    const ordinary = await chat.publish({
      role: 'assistant',
      taskId: task.id,
      text: 'Private task progress',
    });
    expect((await chat.history({})).messages.map((m) => m.id)).not.toContain(
      ordinary.id,
    );
    // Existing cards are promoted without copying them or exposing ordinary Task messages.
    await fixture.database.pool.query(
      'update messages set main_visible=false where id=$1',
      [card.id],
    );
    await fixture.database.pool.query(
      await readFile('migrations/0022_main_secure_entry.sql', 'utf8'),
    );
    expect(
      (await chat.history({})).messages.find((m) => m.id === card.id),
    ).toMatchObject({
      taskId: task.id,
      mainVisible: true,
      version: card.version + 1,
    });
    expect((await chat.history({})).messages.map((m) => m.id)).not.toContain(
      ordinary.id,
    );

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
    expect(result.body.status).toBe('filled');
    expect(await page.locator('#user').inputValue()).toBe(
      'SYNTHETIC_PRIVATE_USER',
    );
    await page.locator('#user').fill('');
    await request(fixture.url)
      .post('/login/requests/' + pending.requestId + '/save')
      .send({ username: 'ignored', password: 'ignored', label: 'Ignored' })
      .expect(201);
    expect(await page.locator('#user').inputValue()).toBe('');
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
    outputs.push(await login.fill(task.id, { username: fresh.inputs[0].ref }));
    expect(await page.locator('#user').inputValue()).toBe(
      'SYNTHETIC_PRIVATE_USER',
    );
    await page.setContent(
      '<form><input id="pass" type="password" autocomplete="current-password"></form><textarea id="comment"></textarea>',
    );
    const passwordStage = await login.inspect(task.id);
    expect(
      (await fixture.app.get(LoginRepository).active()).filter(
        (r) => r.taskId === task.id,
      ),
    ).toHaveLength(0);
    outputs.push(
      await login.fill(task.id, { password: passwordStage.inputs[0].ref }),
    );
    expect(await page.locator('#pass').inputValue()).toBe(
      'SYNTHETIC_PRIVATE_PASSWORD',
    );
    // The model sees rejection, inspects fresh fields and can request corrected credentials.
    await page.locator('form').evaluate((form) => {
      const error = document.createElement('p');
      error.textContent =
        'Check the account information you entered and try again.';
      form.append(error);
    });
    const rejected = await login.inspect(task.id);
    const replacement = await login.request(task.id, {
      password: rejected.inputs[0].ref,
    });
    expect(replacement.status).toBe('awaiting_user');
    await login.finish(replacement.requestId!);
    expect(await page.locator('#comment').inputValue()).toBe('');
    // A new flow can collect a different login despite an existing saved match.
    const otherTask = await fixture.app.get(TasksService).create({
      title: 'Different account',
      goal: 'Sign in with new details',
    });
    await page.goto('https://example.test/another-login');
    const otherInspection = await login.inspect(otherTask.id);
    expect(otherInspection.accounts).toHaveLength(1);
    const otherRequest = await loginTools(login).secure_entry_request.execute!(
      { fields: { username: otherInspection.inputs[0].ref } },
      {
        requestContext: new RequestContext([
          [MASTRA_THREAD_ID_KEY, 'pal-task:' + otherTask.id],
        ]),
        observe: noopObserve,
      },
    );
    expect(otherRequest.status).toBe('awaiting_user');
    if (
      !('requestId' in otherRequest) ||
      typeof otherRequest.requestId !== 'string'
    )
      throw new Error('Expected new login entry');
    expect(otherRequest.requestId).not.toBe(pending.requestId);
    await request(fixture.url)
      .post(`/login/requests/${otherRequest.requestId}/save`)
      .send({
        username: 'SYNTHETIC_PRIVATE_OTHER_USER',
        password: 'SYNTHETIC_PRIVATE_OTHER_PASSWORD',
        label: 'Other',
      })
      .expect(201);
    expect(items).toHaveLength(2);
    outputs.push(otherRequest, await login.get(otherRequest.requestId));
    const otherUsername = await login.inspect(otherTask.id);
    outputs.push(
      await login.fill(otherTask.id, { username: otherUsername.inputs[0].ref }),
    );
    expect(await page.locator('#user').inputValue()).toBe(
      'SYNTHETIC_PRIVATE_OTHER_USER',
    );
    await page.setContent(
      '<input type="password" id="pass" autocomplete="current-password">',
    );
    const otherPassword = await login.inspect(otherTask.id);
    outputs.push(
      await login.fill(otherTask.id, { password: otherPassword.inputs[0].ref }),
    );
    expect(await page.locator('#pass').inputValue()).toBe(
      'SYNTHETIC_PRIVATE_OTHER_PASSWORD',
    );
    // Choosing another stored account explicitly changes the selected account.
    outputs.push(
      await login.fill(
        otherTask.id,
        { password: otherPassword.inputs[0].ref },
        items[0].id,
      ),
    );
    expect(await page.locator('#pass').inputValue()).toBe(
      'SYNTHETIC_PRIVATE_PASSWORD',
    );
    const originalPassword = await login.inspect(task.id);
    outputs.push(
      await login.fill(task.id, { password: originalPassword.inputs[0].ref }),
    );
    expect(await page.locator('#pass').inputValue()).toBe(
      'SYNTHETIC_PRIVATE_PASSWORD',
    );
    await page.setContent(
      '<form>' +
        Array.from(
          { length: 6 },
          (_, i) => `<input type="tel" aria-label="${i + 1}">`,
        ).join('') +
        '</form>',
    );
    const otp = await login.inspect(task.id);
    expect(otp.inputs).toHaveLength(6);
    expect(
      (
        await login.fill(task.id, {
          code: otp.inputs.map((input) => input.ref),
        })
      ).status,
    ).toBe('input_required');
    const codeRequest = await login.request(task.id, {
      code: otp.inputs.map((input) => input.ref),
    });
    expect(codeRequest.kind).toBe('code');
    const snapshot = (
      await request(fixture.url)
        .get(`/login/requests/${codeRequest.requestId}`)
        .expect(200)
    ).body;
    expect(snapshot.inspectionId).toBe(otp.inspectionId);
    expect(snapshot.kind).toBe('code');
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
    expect(save).toHaveBeenCalledTimes(2);
    const staleRequest = await login.request(task.id, {
      code: otp.inputs.map((input) => input.ref),
    });
    await page.goto('https://example.test/other');
    const stale = await request(fixture.url)
      .post(`/login/requests/${staleRequest.requestId}/code`)
      .send({ code })
      .expect(201);
    expect(stale.body.status).toBe('updating');
    expect(JSON.stringify(stale.body)).not.toContain(code);
    expect((await login.get(staleRequest.requestId!)).inspectionId).toBeNull();
    await until(async () => {
      await login.flushNotifications();
      return notifications.some((text) => text.includes('Automatic recovery'));
    });
    await page.setContent('<input autocomplete="one-time-code" id="code">');
    const refreshed = await login.inspect(task.id);
    const replacementCode = await login.request(task.id, {
      code: [refreshed.inputs[0].ref],
    });
    expect(replacementCode.requestId).not.toBe(staleRequest.requestId);
    const restored = await login.get(staleRequest.requestId!);
    expect(restored.id).toBe(replacementCode.requestId);
    expect(restored.inspectionId).toBe(refreshed.inspectionId);
    const cards = (
      await fixture.app.get(ChatService).history({ taskId: task.id })
    ).messages.filter(
      (m) => m.metadata.secureEntryRequestId === staleRequest.requestId,
    );
    expect(cards).toHaveLength(1);
    await request(fixture.url)
      .post(`/login/requests/${staleRequest.requestId}/code`)
      .send({ code })
      .expect(201);
    expect(await page.locator('#code').inputValue()).toBe('');
    await request(fixture.url)
      .post(`/login/requests/${replacementCode.requestId}/code`)
      .send({ code })
      .expect(201);
    expect(await page.locator('#code').inputValue()).toBe(code);
    expect(JSON.stringify({ outputs, notifications })).not.toContain(
      'SYNTHETIC_PRIVATE',
    );
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

it('remembers verified accounts and session intent across callers and restarts without promoting saves or fills', async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    executablePath: process.env.TEST_CHROMIUM_PATH,
    headless: true,
  });
  const page = await browser.newPage();
  await page.route('https://accounts.example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<input autocomplete="username"><input type="password" autocomplete="current-password">',
    }),
  );
  await page.route('https://store.example.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Signed in</p>' }),
  );
  await page.goto('https://accounts.example.test/login');
  const browserService = fixture.app.get(BrowserService);
  const selected = vi
    .spyOn(browserService, 'selectedPage')
    .mockResolvedValue(page);
  const vault = fixture.app.get(BitwardenService);
  const repository = fixture.app.get(LoginRepository);
  const original = fixture.app.get(LoginService);
  const tasks = fixture.app.get(TasksService);
  const [a, b, c, d] = await Promise.all(
    ['A', 'B', 'C', 'D'].map((title) =>
      tasks.create({ title, goal: 'Verify login defaults' }),
    ),
  );
  const items = ['Personal', 'Work'].map((name) => ({
    id: randomUUID(),
    name,
    type: 1,
    login: {
      username: 'PRIVATE_LOGIN_' + name,
      password: 'PRIVATE_PASSWORD_' + name,
    },
  }));
  const configured = vi.spyOn(vault, 'configured', 'get').mockReturnValue(true);
  const matching = vi
    .spyOn(vault, 'matching')
    .mockImplementation(async () => structuredClone(items));
  const save = vi
    .spyOn(vault, 'save')
    .mockImplementation(async (_origin, input) => {
      const item = {
        id: randomUUID(),
        name: input.label,
        type: 1,
        login: { username: input.username, password: input.password },
      };
      items.push(item);
      return item.id;
    });
  const restart = () =>
    new LoginService(
      browserService,
      vault,
      repository,
      fixture.app.get(EventsService),
      tasks,
      fixture.app.get(ChatService),
    );
  const fields = (
    inspection: Awaited<ReturnType<LoginService['inspect']>>,
  ) => ({
    username: inspection.inputs[0].ref,
    password: inspection.inputs[1].ref,
  });
  const origin = 'https://accounts.example.test';
  const outputs: unknown[] = [];
  const notifications: string[] = [];
  original.bindNotifier(async (_id, text) => {
    notifications.push(text);
  });
  try {
    await expect(original.session(a.id, 'preference')).rejects.toMatchObject({
      code: 'invalid_input',
    });
    const first = fields(await original.inspect(a.id));
    const ambiguous = await original.fill(a.id, first);
    expect(ambiguous).toMatchObject({
      status: 'awaiting_user',
      chooseAccount: true,
    });
    if (!('requestId' in ambiguous)) throw new Error('Expected account picker');
    expect(await original.fill(a.id, first)).toMatchObject({
      requestId: ambiguous.requestId,
    });
    const picker = await request(fixture.url)
      .get(`/login/requests/${ambiguous.requestId}`)
      .expect(200);
    expect(picker.body).toMatchObject({
      chooseAccount: true,
      accounts: items.map((item) => ({ id: item.id, label: item.name })),
    });
    outputs.push(picker.body);
    await request(fixture.url)
      .post(`/login/requests/${ambiguous.requestId}/select`)
      .send({ accountId: randomUUID() })
      .expect(400);
    const selection = await request(fixture.url)
      .post(`/login/requests/${ambiguous.requestId}/select`)
      .send({ accountId: items[0].id, keepMeSignedIn: true })
      .expect(201);
    expect(selection.body.status).toBe('filled');
    expect(await page.locator('input[type=password]').inputValue()).toBe(
      'PRIVATE_PASSWORD_Personal',
    );
    await page.locator('input[type=password]').fill('');
    outputs.push(selection.body);
    await until(async () => {
      await original.flushNotifications();
      return notifications.some((text) => text.includes('is filled.'));
    });
    outputs.push(notifications);
    // A duplicate selection cannot switch the account or checkbox after completion.
    await request(fixture.url)
      .post(`/login/requests/${ambiguous.requestId}/select`)
      .send({ accountId: items[1].id, keepMeSignedIn: false })
      .expect(201);
    expect(await page.locator('input[type=password]').inputValue()).toBe('');
    expect(await repository.selection(a.id)).toMatchObject({
      accountId: items[0].id,
      keepMeSignedIn: true,
    });
    outputs.push(await original.fill(a.id, first));
    expect((await repository.site(origin))?.lastAccountId).toBeNull();
    // Success is an explicit agent report after website verification, independent of save/fill.
    outputs.push(
      await loginTools(original).login_session.execute!(
        { action: 'complete', keepMeSignedIn: null },
        {
          requestContext: new RequestContext([
            [MASTRA_THREAD_ID_KEY, 'pal-task:' + a.id],
          ]),
          observe: noopObserve,
        },
      ),
    );
    expect(await repository.site(origin)).toMatchObject({
      lastAccountId: items[0].id,
      keepMeSignedIn: true,
    });
    const restarted = restart();
    const second = fields(await restarted.inspect(b.id));
    expect(await restarted.fill(b.id, second)).toMatchObject({
      accountId: items[0].id,
      keepMeSignedIn: true,
    });
    expect(
      (
        await fixture.database.pool.query(
          'select id from login_requests where task_id=$1',
          [b.id],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      await restarted.fill(b.id, second, items[1].id, undefined, false),
    ).toMatchObject({ accountId: items[1].id, keepMeSignedIn: false });
    expect((await repository.site(origin))?.lastAccountId).toBe(items[0].id);
    await restarted.session(b.id, 'preference', undefined, true);
    expect((await repository.site(origin))?.lastAccountId).toBe(items[0].id);
    await restarted.session(b.id, 'preference', undefined, false);
    await original.session(a.id, 'preference', undefined, true);
    // Confirming an older intent must not overwrite a more recent preference choice.
    outputs.push(await restarted.session(b.id, 'complete'));
    await original.session(a.id, 'complete'); // A duplicate old report cannot replace the newer B choice.
    expect(await repository.site(origin)).toMatchObject({
      lastAccountId: items[1].id,
      keepMeSignedIn: true,
    });
    const third = fields(await restarted.inspect(c.id));
    expect(await restarted.fill(c.id, third)).toMatchObject({
      accountId: items[1].id,
    });
    // Explicit switching opens the picker even when an active/default account is known.
    const entry = await loginTools(restarted).secure_entry_request.execute!(
      { fields: third, chooseAccount: true, keepMeSignedIn: true },
      {
        requestContext: new RequestContext([
          [MASTRA_THREAD_ID_KEY, 'pal-task:' + c.id],
        ]),
        observe: noopObserve,
      },
    );
    if (
      !entry ||
      !('requestId' in entry) ||
      typeof entry.requestId !== 'string'
    )
      throw new Error('Expected explicit picker');
    expect(entry).toMatchObject({ chooseAccount: true });
    expect((await restarted.get(entry.requestId)).keepMeSignedIn).toBe(true);
    // A private checkbox submission can override the preference supplied in user text.
    await request(fixture.url)
      .post(`/login/requests/${entry.requestId}/save`)
      .send({
        username: 'PRIVATE_LOGIN_NEW',
        password: 'PRIVATE_PASSWORD_NEW',
        label: 'New',
        keepMeSignedIn: 'yes',
      })
      .expect(400);
    await request(fixture.url)
      .post(`/login/requests/${entry.requestId}/save`)
      .send({
        username: 'PRIVATE_LOGIN_NEW',
        password: 'PRIVATE_PASSWORD_NEW',
        label: 'New',
        keepMeSignedIn: false,
      })
      .expect(201);
    expect((await repository.site(origin))?.lastAccountId).toBe(items[1].id);
    const resumed = restart();
    const newFields = fields(await resumed.inspect(c.id));
    expect(await resumed.fill(c.id, newFields)).toMatchObject({
      accountId: items[2].id,
      keepMeSignedIn: false,
    });
    expect(await page.locator('input[type=password]').inputValue()).toBe(
      'PRIVATE_PASSWORD_NEW',
    );
    // Redirecting back to the merchant still confirms the original credential origin.
    await page.goto('https://store.example.test/account');
    outputs.push(await resumed.session(c.id, 'complete'));
    await restarted.session(b.id, 'complete');
    expect((await repository.site(origin))?.lastAccountId).toBe(items[2].id);
    await resumed.session(c.id, 'preference', undefined, true); // Explicit text also updates the remembered intent.
    expect((await repository.site(origin))?.keepMeSignedIn).toBe(true);
    await page.goto('https://accounts.example.test/login');
    const fourth = fields(await resumed.inspect(d.id));
    // A removed or nonmatching remembered account must not bypass current vault matching.
    matching.mockImplementation(async () => structuredClone(items.slice(0, 2)));
    const missingDefault = await resumed.fill(d.id, fourth);
    expect(missingDefault).toMatchObject({
      status: 'awaiting_user',
      chooseAccount: true,
    });
    if (!('requestId' in missingDefault))
      throw new Error('Expected account picker');
    // Cancellation does not change the selected flow or remembered successful account.
    await resumed.finish(missingDefault.requestId);
    await resumed.selectAccount(missingDefault.requestId, items[0].id, false);
    expect(await repository.selection(d.id)).toBeUndefined();
    matching.mockImplementation(async () => [structuredClone(items[0])]);
    expect(await resumed.fill(d.id, fourth)).toMatchObject({
      accountId: items[0].id,
      keepMeSignedIn: true,
    });
    expect((await repository.site(origin))?.lastAccountId).toBe(items[2].id);
    await expect(resumed.fill(d.id, fourth, items[2].id)).rejects.toMatchObject(
      { code: 'conflict' },
    );
    const staleFields = fields(await resumed.inspect(d.id));
    const staleEntry = await resumed.request(d.id, staleFields);
    await page.goto('https://accounts.example.test/changed');
    const fallback = await resumed.finish(staleEntry.requestId, {
      username: 'PRIVATE_LOGIN_FALLBACK',
      password: 'PRIVATE_PASSWORD_FALLBACK',
      label: 'Fallback',
    });
    expect(fallback.status).toBe('saved');
    expect(await page.locator('input[type=password]').inputValue()).toBe('');
    expect(await repository.selection(d.id)).toMatchObject({
      accountId: items.at(-1)!.id,
    });
    // A pre-existing authenticated session can remember text intent without inventing an account choice.
    await page.goto('https://store.example.test/account');
    const existing = await tasks.create({
      title: 'Existing session',
      goal: 'Keep the session',
    });
    await resumed.session(existing.id, 'preference', undefined, true);
    expect(await repository.site('https://store.example.test')).toMatchObject({
      lastAccountId: null,
      keepMeSignedIn: true,
    });
    const persisted = await fixture.database.pool.query(
      'select row_to_json(s) as value from login_sites s union all select row_to_json(f) from login_flows f union all select row_to_json(r) from login_requests r',
    );
    expect(JSON.stringify({ outputs, persisted: persisted.rows })).not.toMatch(
      /PRIVATE_LOGIN|PRIVATE_PASSWORD/,
    );
  } finally {
    original.onModuleDestroy();
    selected.mockRestore();
    configured.mockRestore();
    matching.mockRestore();
    save.mockRestore();
    await browser.close();
  }
});

it('recovers code requests after restart, bounds attempts, times out, and resumes only after explicit retry', async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    executablePath: process.env.TEST_CHROMIUM_PATH,
    headless: true,
  });
  const task = await fixture.app.get(TasksService).create({
    title: 'Recovery fixture',
    goal: 'Verify bounded private recovery',
  });
  const page = await browser.newPage();
  await page.route('https://recovery.example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<input id="code" maxlength="6" autocomplete="one-time-code">',
    }),
  );
  await page.goto('https://recovery.example.test/');
  const browserService = fixture.app.get(BrowserService);
  const selected = vi
    .spyOn(browserService, 'selectedPage')
    .mockResolvedValue(page);
  const repository = fixture.app.get(LoginRepository);
  const original = fixture.app.get(LoginService);
  const notifications: string[] = [];
  let restarted: LoginService | undefined;
  try {
    const inspection = await original.inspect(task.id);
    const first = await original.request(task.id, {
      code: [inspection.inputs[0].ref],
    });
    const root = first.requestId!;
    original.onModuleDestroy();
    restarted = new LoginService(
      browserService,
      fixture.app.get(BitwardenService),
      repository,
      fixture.app.get(EventsService),
      fixture.app.get(TasksService),
      fixture.app.get(ChatService),
    );
    restarted.bindNotifier(async (_id, text) => {
      notifications.push(text);
    });
    await until(async () => {
      await restarted!.flushNotifications();
      return (await restarted!.get(root)).status === 'updating';
    });
    expect((await restarted.get(root)).inspectionId).toBeNull();
    for (let attempt = 1; attempt <= 2; attempt++) {
      const fresh = await restarted.inspect(task.id);
      const next = await restarted.request(task.id, {
        code: [fresh.inputs[0].ref],
      });
      expect((await repository.get(next.requestId!)).recoveryAttempts).toBe(
        attempt,
      );
      if (attempt === 1) {
        // Invalid values stay input errors and do not consume a recovery attempt.
        await expect(
          restarted.submitCode(next.requestId!, '1234567'),
        ).rejects.toMatchObject({ code: 'invalid_input' });
        expect((await restarted.get(root)).status).toBe('pending');
      }
      await page.setContent(
        '<input id="code" maxlength="6" autocomplete="one-time-code">',
      );
      const result = await restarted.submitCode(next.requestId!, '731946');
      expect(result.status).toBe(attempt === 1 ? 'updating' : 'failed');
      expect(await page.locator('#code').inputValue()).toBe('');
    }
    const failed = await restarted.get(root);
    const fresh = await restarted.inspect(task.id);
    await expect(
      restarted.request(task.id, { code: [fresh.inputs[0].ref] }),
    ).rejects.toThrow(/recovery stopped/);
    await restarted.retry(failed.id);
    expect((await restarted.get(root)).status).toBe('updating');
    const retryInspection = await restarted.inspect(task.id);
    const retried = await restarted.request(task.id, {
      code: [retryInspection.inputs[0].ref],
    });
    expect((await repository.get(retried.requestId!)).recoveryAttempts).toBe(1);
    await restarted.finish(retried.requestId!);
    expect((await restarted.get(root)).status).toBe('cancelled');
    const timeout = await restarted.request(task.id, {
      code: [retryInspection.inputs[0].ref],
    });
    await fixture.database.pool.query(
      "update login_requests set created_at=now()-interval '11 minutes' where id=$1",
      [timeout.requestId],
    );
    expect(
      (await restarted.submitCode(timeout.requestId!, '731946')).status,
    ).toBe('updating');
    await fixture.database.pool.query(
      "update login_requests set recovery_at=now()-interval '3 minutes' where id=$1",
      [timeout.requestId],
    );
    await until(async () => {
      await restarted!.flushNotifications();
      return (await restarted!.get(timeout.requestId!)).status === 'failed';
    });
    await restarted.retry(timeout.requestId!);
    expect((await restarted.get(timeout.requestId!)).status).toBe('updating');
    await restarted.finish(timeout.requestId!);
    expect((await restarted.get(timeout.requestId!)).status).toBe('cancelled');
    const closeInspection = await restarted.inspect(task.id);
    const closeRequest = await restarted.request(task.id, {
      code: [closeInspection.inputs[0].ref],
    });
    await fixture.app
      .get(TasksService)
      .update(task.id, { status: 'completed' });
    await until(async () => {
      await restarted!.flushNotifications();
      return (
        (await restarted!.get(closeRequest.requestId!)).status === 'cancelled'
      );
    });
    const cards = (
      await fixture.app.get(ChatService).history({ taskId: task.id })
    ).messages;
    expect(
      cards.filter((message) => message.metadata.secureEntryRequestId === root),
    ).toHaveLength(1);
    expect(JSON.stringify({ cards, notifications })).not.toContain('731946');
  } finally {
    restarted?.onModuleDestroy();
    selected.mockRestore();
    await browser.close();
  }
});

it('acts before masked inspection across new tabs, delayed navigation, same-page updates and failures', async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    executablePath: process.env.TEST_CHROMIUM_PATH,
    headless: true,
  });
  const context = await browser.newContext();
  const task = await fixture.app
    .get(TasksService)
    .create({ title: 'Action inspection', goal: 'Inspect after navigation' });
  const login = fixture.app.get(LoginService);
  const workerId = randomUUID();
  const caller = {
    requestContext: new RequestContext([
      [MASTRA_THREAD_ID_KEY, 'pal-task:' + task.id],
      [PARENT_TASK_ID, task.id],
      [WORKER_ID, workerId],
    ]),
    observe: noopObserve,
  };
  let releaseStep!: () => void;
  const step = new Promise<void>((resolve) => {
    releaseStep = resolve;
  });
  let requested = false;
  await context.route('https://action.example.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/step') {
      requested = true;
      await step;
      return route.fulfill({ json: {} });
    }
    return route.fulfill({
      contentType: 'text/html',
      body:
        path === '/password'
          ? `<input type="password" autocomplete="current-password" value="MASKED_INITIAL"><button onclick="if(document.querySelector('input').value==='SENTINEL_PASSWORD')location.href='/verify'">Sign in</button>`
          : path === '/verify'
            ? '<input autocomplete="one-time-code">'
            : '<input autocomplete="username"><button onclick="fetch(\'/step\').then(()=>location.href=\'/password\')">Next</button>',
    });
  });
  let current = await context.newPage();
  const selected = vi
    .spyOn(fixture.app.get(BrowserService), 'selectedPage')
    .mockImplementation(async () => current);
  const command = vi
    .spyOn(fixture.app.get(BrowserService), 'command')
    .mockImplementation(async (_id, args) => {
      if (args[0] === 'fail')
        return { success: false, data: null, error: 'SECRET_PROVIDER_ERROR' };
      if (args[0] === 'tab') {
        current = await context.newPage();
        await current.goto(args[2]);
      } else if (args[0] === 'click') await current.locator('button').click();
      else if (args[0] === 'eval') await current.evaluate(args[1]);
      return { success: true, data: {}, error: null };
    });
  const repository = fixture.app.get(LoginRepository);
  const stored = vi.spyOn(repository, 'inspection');
  const item = {
    id: randomUUID(),
    name: 'Personal',
    type: 1,
    login: { username: 'SENTINEL_USER', password: 'SENTINEL_PASSWORD' },
  };
  let items = [item, { ...item, id: randomUUID(), name: 'Work' }];
  const vault = fixture.app.get(BitwardenService);
  const configured = vi.spyOn(vault, 'configured', 'get').mockReturnValue(true);
  const matching = vi
    .spyOn(vault, 'matching')
    .mockImplementation(async () => structuredClone(items));
  try {
    const tools = loginTools(login);
    const tool = tools.login_inspect;
    const opened = await tool.execute!(
      { action: ['tab', 'new', 'https://action.example.test/login'] },
      caller,
    );
    if (!('inputs' in opened)) throw new Error('Expected initial inspection');
    expect(opened.inputs[0].autocomplete).toBe('username');
    expect(command).toHaveBeenCalledWith(
      task.id,
      ['tab', 'new', 'https://action.example.test/login'],
      undefined,
      workerId,
    );
    const beforeStored = stored.mock.calls.length;
    const navigating = tool.execute!({ action: ['click', 'button'] }, caller);
    await until(() => requested);
    expect(stored).toHaveBeenCalledTimes(beforeStored);
    releaseStep();
    const next = await navigating;
    if (!('inputs' in next)) throw new Error('Expected password inspection');
    expect(next.inputs.map((input) => input.type)).toEqual(['password']);
    expect(JSON.stringify(next.inputs)).not.toContain('SENTINEL');
    await expect(
      login.fill(
        task.id,
        { username: opened.inputs[0].ref },
        undefined,
        workerId,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    const fields = { password: next.inputs[0].ref };
    let commands = command.mock.calls.length;
    const picker = await tools.secure_fill.execute!(
      { fields, action: ['click', 'button'] },
      caller,
    );
    expect(picker).toMatchObject({ status: 'awaiting_user' });
    expect(command).toHaveBeenCalledTimes(commands);
    expect((await fixture.app.get(TasksService).details(task.id)).status).toBe(
      'needs-input',
    );
    if (!('requestId' in picker)) throw new Error('Expected picker');
    await repository.finish(picker.requestId);
    items = [item];
    const wrongOwner = await tools.secure_fill.execute!(
      { fields, action: ['click', 'button'] },
      {
        requestContext: new RequestContext([
          [MASTRA_THREAD_ID_KEY, 'pal-task:' + task.id],
        ]),
        observe: noopObserve,
      },
    );
    expect(wrongOwner).toMatchObject({ status: 'error', code: 'conflict' });
    expect(command).toHaveBeenCalledTimes(commands);
    const filled = await tools.secure_fill.execute!(
      { fields, action: ['click', 'button'] },
      caller,
    );
    expect(filled).toMatchObject({ status: 'filled', accountId: item.id });
    if (!('inputs' in filled))
      throw new Error('Expected native inspection after fill');
    expect(filled.inputs[0].autocomplete).toBe('one-time-code');
    expect(current.url()).toBe('https://action.example.test/verify');
    expect(command).toHaveBeenLastCalledWith(
      task.id,
      ['click', 'button'],
      undefined,
      workerId,
    );
    const media = tools.secure_fill.toModelOutput!(filled);
    expect(media).toMatchObject({
      type: 'content',
      value: [{ type: 'text' }, { type: 'media', mediaType: 'image/png' }],
    });
    expect(JSON.stringify(media)).not.toContain('SENTINEL');
    if (media.type !== 'content') throw new Error('Expected media');
    expect(JSON.stringify(media.value[0])).not.toContain(filled.image);
    commands = command.mock.calls.length;
    const needsCode = await tools.secure_fill.execute!(
      { fields: { code: [filled.inputs[0].ref] }, action: ['click', 'button'] },
      caller,
    );
    expect(needsCode).toMatchObject({ status: 'input_required' });
    const stale = await tools.secure_fill.execute!(
      { fields, action: ['click', 'button'] },
      caller,
    );
    expect(stale).toMatchObject({ status: 'error', code: 'conflict' });
    expect(command).toHaveBeenCalledTimes(commands);
    const samePage = await tool.execute!(
      {
        action: [
          'eval',
          'document.body.innerHTML="<input autocomplete=one-time-code>"',
        ],
      },
      caller,
    );
    if (!('inputs' in samePage))
      throw new Error('Expected same-page inspection');
    expect(samePage.inputs[0].autocomplete).toBe('one-time-code');
    const calls = command.mock.calls.length;
    expect(await tool.execute!({ action: null }, caller)).toHaveProperty(
      'inputs',
    );
    expect(command).toHaveBeenCalledTimes(calls);
    const beforeFailure = stored.mock.calls.length;
    const failed = await tool.execute!({ action: ['fail'] }, caller);
    expect(failed).toMatchObject({ status: 'error', code: 'unavailable' });
    expect(JSON.stringify(failed)).not.toContain('SECRET');
    expect(stored).toHaveBeenCalledTimes(beforeFailure);
    await current.goto('https://action.example.test/password');
    const fresh = await tool.execute!({}, caller);
    if (!('inputs' in fresh)) throw new Error('Expected fresh password field');
    const freshFields = { password: fresh.inputs[0].ref };
    commands = command.mock.calls.length;
    items = [];
    const missing = await tools.secure_fill.execute!(
      { fields: freshFields, action: ['click', 'button'] },
      caller,
    );
    expect(missing).toMatchObject({ status: 'error', code: 'conflict' });
    expect(command).toHaveBeenCalledTimes(commands);
    items = [item];
    const failedAfterFill = await tools.secure_fill.execute!(
      { fields: freshFields, action: ['fail'] },
      caller,
    );
    expect(failedAfterFill).toMatchObject({
      status: 'error',
      code: 'unavailable',
    });
    expect(JSON.stringify(failedAfterFill)).toContain('Fields were filled');
    expect(JSON.stringify(failedAfterFill)).not.toContain('SECRET');
    expect(stored).toHaveBeenCalledTimes(beforeFailure + 1);
    const plain = await tools.secure_fill.execute!(
      { fields: freshFields, action: null },
      caller,
    );
    expect(plain).toMatchObject({ status: 'filled' });
    expect(plain).not.toHaveProperty('image');
    expect(tools.secure_fill.toModelOutput!(plain)).toMatchObject({
      type: 'text',
    });
  } finally {
    releaseStep();
    matching.mockRestore();
    configured.mockRestore();
    stored.mockRestore();
    selected.mockRestore();
    command.mockRestore();
    await browser.close();
  }
});
