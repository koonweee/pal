import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
} from '@mastra/core/request-context';
import { noopObserve } from '@mastra/core/tools';
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
