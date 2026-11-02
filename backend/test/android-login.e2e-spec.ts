import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { startTestApp } from './helpers.js';
import { AndroidService } from '../dist/android/android.service.js';
import { LoginService } from '../dist/login/login.service.js';
import { LoginRepository } from '../dist/login/login.repository.js';
import {
  BitwardenService,
  type VaultItem,
} from '../dist/login/bitwarden.service.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { loginTools } from '../dist/login/login-tools.js';
import { RequestContext } from '@mastra/core/request-context';
import { noopObserve } from '@mastra/core/tools';
import { PARENT_TASK_ID, WORKER_ID } from '../dist/agent/task-workers.js';

it('uses shared private HTTP entry, staged vault reuse and transient codes with bound Android identity and cancellation', async () => {
  const packageName = 'dev.pal.fixture';
  const session = randomUUID();
  let ref = '',
    stage = 0,
    changed = false;
  let loseFillResponse = false;
  const fills: string[] = [],
    actions: string[] = [];
  const secret = ['NATIVE_PRIVATE_USER', 'NATIVE_PRIVATE_PASSWORD', '385621'];
  const server = createServer(async (req, res) => {
    expect(req.url).toBe('/secure');
    expect(req.headers.authorization).toBe('Bearer fixture');
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    actions.push(input.action);
    expect(input.device).toBe('phone');
    res.setHeader('Content-Type', 'application/json');
    if (input.action === 'pause') {
      res.end(JSON.stringify({ status: 'stopped' }));
      return;
    }
    if (input.action === 'inspect') {
      ref = 'i1-' + randomBytes(12).toString('base64url');
      res.end(
        JSON.stringify({
          status: 'ready',
          session,
          identity: {
            packageName,
          },
          inputs: [
            {
              ref,
              type: stage === 1 ? 'password' : 'text',
              password: false,
              inputType: 1,
              label: ['Username', 'Password', 'Code'][stage],
              identifier: 'field',
              maxLength: -1,
            },
          ],
          image:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
        }),
      );
      return;
    }
    const valid =
      !changed &&
      input.session === session &&
      input.packageName === packageName &&
      input.fields.every((field: { ref: string }) => field.ref === ref);
    if (valid && input.action === 'fill') fills.push(input.fields[0].value);
    if (valid && input.action === 'fill' && loseFillResponse) {
      loseFillResponse = false;
      req.socket.destroy();
      return;
    }
    res.end(
      JSON.stringify({
        status: valid
          ? input.action === 'fill'
            ? 'filled'
            : 'valid'
          : 'error',
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing native fixture');
  const fixture = await startTestApp({
    config: {
      PAL_ANDROID_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
      PAL_ANDROID_MCP_TOKEN: 'fixture',
      PAL_ANDROID_DEVICE_ID: 'phone',
    },
  });
  const android = fixture.app.get(AndroidService),
    login = fixture.app.get(LoginService),
    repository = fixture.app.get(LoginRepository),
    vault = fixture.app.get(BitwardenService);
  const task = await fixture.app
    .get(TasksService)
    .create({ title: 'Native entry', goal: 'Verify secure Android login' });
  const workerId = randomUUID(),
    owner = { taskId: task.id, workerId };
  const items: VaultItem[] = [];
  vi.spyOn(vault, 'configured', 'get').mockReturnValue(true);
  vi.spyOn(vault, 'matching').mockImplementation(async (url) =>
    url.startsWith('https://native.example.test') ? structuredClone(items) : [],
  );
  vi.spyOn(vault, 'save').mockImplementation(async (_origin, input) => {
    let item = items.find((item) => item.id === input.accountId);
    if (!item) {
      item = { id: randomUUID(), type: 1, name: 'Native fixture', login: {} };
      items.push(item);
    }
    item.login = {
      ...item.login,
      ...(input.username ? { username: input.username } : {}),
      ...(input.password ? { password: input.password } : {}),
    };
    return item.id;
  });
  const tools = loginTools(login);
  const context = {
    requestContext: new RequestContext([
      [PARENT_TASK_ID, task.id],
      [WORKER_ID, workerId],
    ]),
    observe: noopObserve,
  };
  const outputs: unknown[] = [];
  try {
    await expect(
      login.inspect(task.id, workerId, undefined, undefined, 'android'),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      login.inspect(
        task.id,
        workerId,
        undefined,
        undefined,
        'android',
        'http://native.example.test',
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    login.activateSurface(task.id, workerId, 'android');
    for (const [index, role] of ['username', 'password', 'code'].entries()) {
      stage = index;
      const inspected = await tools.inspect_private_fields.execute!(
        { accountOrigin: 'https://native.example.test/login' },
        context,
      );
      outputs.push(inspected);
      expect(inspected).toHaveProperty('app', packageName);
      if (!('inputs' in inspected)) throw new Error('Expected native fields');
      const fields =
        role === 'code'
          ? { code: [inspected.inputs[0].ref] }
          : { [role]: inspected.inputs[0].ref };
      const pending = await login.request(task.id, fields, workerId);
      outputs.push(pending);
      expect(await login.retainWorkerSession(task.id, workerId, true, 0)).toBe(
        true,
      );
      await android.release(task.id, workerId, true);
      expect(
        await login.resumeWorker(
          task.id,
          'secure entry request ' + pending.requestId,
        ),
      ).toBe(workerId);
      await expect(
        android.call(
          { taskId: 'other', workerId: 'other' },
          'android_apps',
          {},
        ),
      ).rejects.toThrow('busy');
      if (role === 'code')
        await request(fixture.url)
          .post(`/login/requests/${pending.requestId}/code`)
          .send({ code: secret[index] })
          .expect(201);
      else {
        const privateInput = {
          [role]: secret[index],
          ...(role === 'username' ? { label: 'Native fixture' } : {}),
        };
        await request(fixture.url)
          .post(`/login/requests/${pending.requestId}/save`)
          .send(privateInput)
          .expect(201);
        await request(fixture.url)
          .post(`/login/requests/${pending.requestId}/save`)
          .send(privateInput)
          .expect(201);
      }
      expect((await login.get(pending.requestId)).status).toBe('filled');
      outputs.push(await login.get(pending.requestId));
    }
    expect(items).toHaveLength(1);
    expect(items[0].login).toMatchObject({
      username: secret[0],
      password: secret[1],
    });
    expect(fills).toEqual(secret);
    stage = 1;
    const inspection = await login.inspect(
      task.id,
      workerId,
      undefined,
      undefined,
      'android',
      'https://native.example.test',
    );
    const fields = { password: inspection.inputs[0].ref };
    outputs.push(await login.fill(task.id, fields, undefined, workerId));
    expect(fills.at(-1)).toBe(secret[1]);
    await expect(
      login.fill(task.id, fields, undefined, workerId, true),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    changed = true;
    await expect(
      login.fill(task.id, fields, undefined, workerId),
    ).rejects.toMatchObject({ code: 'conflict' });
    changed = false;
    const fresh = await login.inspect(
      task.id,
      workerId,
      undefined,
      undefined,
      'android',
      'https://native.example.test',
    );
    const cancelled = await login.request(
      task.id,
      { password: fresh.inputs[0].ref },
      workerId,
    );
    const replacementInspection = await login.inspect(
      task.id,
      workerId,
      undefined,
      undefined,
      'android',
      'https://replacement.example.test',
    );
    const replacement = await login.request(
      task.id,
      { password: replacementInspection.inputs[0].ref },
      workerId,
    );
    await login.finish(cancelled.requestId);
    expect(android.owns(task.id, workerId)).toBe(true);
    await login.finish(replacement.requestId);
    expect(android.owns(task.id, workerId)).toBe(false);
    const nextOwner = { taskId: randomUUID(), workerId: randomUUID() };
    await android.secure(nextOwner, { action: 'inspect' });
    await android.release(nextOwner.taskId, nextOwner.workerId);
    const count = fills.length;
    await request(fixture.url)
      .post(`/login/requests/${cancelled.requestId}/save`)
      .send({ password: secret[1] })
      .expect(201);
    expect(fills).toHaveLength(count);
    await expect(
      login.fill(
        task.id,
        { password: replacementInspection.inputs[0].ref },
        undefined,
        workerId,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    const lateInspection = await login.inspect(
      task.id,
      workerId,
      undefined,
      undefined,
      'android',
      'https://native.example.test',
    );
    const late = await login.request(
      task.id,
      { password: lateInspection.inputs[0].ref },
      workerId,
    );
    await android.release(task.id, workerId);
    const other = { taskId: randomUUID(), workerId: randomUUID() };
    await android.secure(other, { action: 'inspect' });
    await request(fixture.url)
      .post(`/login/requests/${late.requestId}/save`)
      .send({ password: secret[1] })
      .expect(201);
    expect((await login.get(late.requestId)).status).toBe('saved');
    expect(fills).toHaveLength(count);
    await android.release(other.taskId, other.workerId);
    const rows = await fixture.database.pool.query(
      'SELECT row_to_json(r) AS data FROM login_requests r UNION ALL SELECT row_to_json(i) FROM login_inspections i',
    );
    for (const value of secret) {
      expect(JSON.stringify(outputs)).not.toContain(value);
      expect(JSON.stringify(rows.rows)).not.toContain(value);
    }
    const stored = await repository.current(cancelled.requestId);
    expect(stored.destination.kind).toBe('android');
    expect(actions.filter((action) => action === 'fill')).toHaveLength(4);
    const uncertain = await login.inspect(
      task.id,
      workerId,
      undefined,
      undefined,
      'android',
      'https://native.example.test',
    );
    const uncertainFields = { password: uncertain.inputs[0].ref };
    loseFillResponse = true;
    const lost = await tools.enter_private_fields.execute!(
      { fields: uncertainFields },
      context,
    );
    expect(lost).toMatchObject({
      status: 'error',
      code: 'unavailable',
      message: expect.stringContaining('could not be confirmed'),
    });
    expect(fills.length).toBe(5);
    const replay = await tools.enter_private_fields.execute!(
      { fields: uncertainFields },
      context,
    );
    expect(replay).toMatchObject({ status: 'error', code: 'conflict' });
    expect(fills.length).toBe(5);
  } finally {
    vi.restoreAllMocks();
    await android.release(owner.taskId, owner.workerId);
    await fixture.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30000);
