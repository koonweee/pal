// Real Task -> Worker + private HTTP -> shared Bitwarden workflow -> USB phone.
// Runs inside agent-service with a disposable *_test database and owned fixture APK.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '@mastra/core/request-context';
import { DatabaseService } from '../dist/database/database.service.js';
import { EventsService } from '../dist/events/events.service.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { TasksRepository } from '../dist/tasks/tasks.repository.js';
import { AndroidService } from '../dist/android/android.service.js';
import { androidTools } from '../dist/android/android-tools.js';
import { LoginService } from '../dist/login/login.service.js';
import { LoginRepository } from '../dist/login/login.repository.js';
import { BitwardenService } from '../dist/login/bitwarden.service.js';
import { loginTools } from '../dist/login/login-tools.js';
import { FirstPartyLoginController } from '../dist/adapters/first-party/login.controller.js';
import { configureApp } from '../dist/config/configure-app.js';
import { loadAgentInstructions } from '../dist/agent/agent-instructions.js';
import {
  createMainSession,
  MAIN_RESOURCE_ID,
} from '../dist/agent/main-session.js';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import { CodeModeProcessor } from '../dist/agent/code-mode.processor.js';

const connectionString = process.env.TEST_DATABASE_URL;
assert(
  connectionString && new URL(connectionString).pathname.endsWith('_test'),
  'Use an isolated test database',
);
const schemaName = 'pal_android_private_' + randomUUID().replaceAll('-', '');
const secret = {
  username: 'pal-user-É漢字',
  password: 'pal-password-É漢字!72',
  code: '936721',
};
const seen = [],
  notifications = [],
  items = [],
  outputs = [],
  privateFills = [];
let modelSession, app, login, android, vault;
const vaultServer = createServer(async (req, res) => {
  let data;
  if (req.url === '/sync') data = {};
  else if (req.url.startsWith('/list/object/items'))
    data = { data: structuredClone(items) };
  else if (
    req.url.startsWith('/object/item') &&
    ['POST', 'PUT'].includes(req.method)
  ) {
    let body = '';
    for await (const chunk of req) body += chunk;
    data = JSON.parse(body);
    body = '';
    const id = req.method === 'PUT' ? req.url.split('/').at(-1) : randomUUID();
    const index = items.findIndex((item) => item.id === id);
    data.id = id;
    if (index < 0) items.push(structuredClone(data));
    else items[index] = structuredClone(data);
  } else {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: true, data }));
});
await new Promise((resolve) => vaultServer.listen(0, '127.0.0.1', resolve));
const config = new ConfigService({
  ...process.env,
  DATABASE_URL: connectionString,
});
const db = new DatabaseService(config);
const events = new EventsService();
const tasks = new TasksService(db, new TasksRepository(db), events);
const repository = new LoginRepository(db);
const browser = {
  selectedPage: async () => {
    throw new Error('Browser is outside native acceptance');
  },
  groups: async () => [],
};
const channel = new URL(process.env.PAL_ANDROID_MCP_URL);
channel.pathname = '/secure';
const headers = {
  Authorization: 'Bearer ' + process.env.PAL_ANDROID_MCP_TOKEN,
  'Content-Type': 'application/json',
};
const channelCall = async (input) => {
  const response = await fetch(channel, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...input,
      device: process.env.PAL_ANDROID_DEVICE_ID,
    }),
  });
  assert(response.ok, 'Private sidecar readiness');
  return response.json();
};
const noSecrets = (value) => {
  const text = JSON.stringify(value);
  for (const item of [
    ...Object.values(secret),
    'PRIVATE_READONLY_CHILD_CANARY',
  ])
    assert(!text.includes(item), 'Secret escaped into model/public metadata');
};
try {
  await migrate(db.db, { migrationsFolder: './migrations' });
  const initial = await channelCall({ action: 'inspect' });
  assert.equal(initial.status, 'ready', 'Native fixture readiness');
  assert.equal(
    initial.identity.packageName,
    'dev.pal.securefixture',
    'Launch only the owned fixture before acceptance',
  );
  android = new AndroidService(config);
  const privateCall = android.secure.bind(android);
  android.secure = async (owner, input, signal) => {
    const result = await privateCall(owner, input, signal);
    if (input.action === 'fill') {
      assert.equal(result.status, 'filled', 'Native private fill result');
      for (const field of input.fields)
        assert(field.value === secret[field.role], 'Private role value');
      privateFills.push(input.fields.map((field) => field.role));
    }
    noSecrets(result);
    return result;
  };
  class FixtureVault extends BitwardenService {
    get configured() {
      return true;
    }
    get endpoint() {
      return 'http://127.0.0.1:' + vaultServer.address().port;
    }
    async ensureReady() {}
  }
  vault = new FixtureVault(config);
  login = new LoginService(
    browser,
    vault,
    repository,
    events,
    tasks,
    {
      publish: async (message) => {
        noSecrets(message);
      },
    },
    android,
  );
  login.bindNotifier(async (taskId, text) => {
    noSecrets(text);
    notifications.push({ taskId, text });
  });
  class PrivateHttpModule {}
  Module({
    controllers: [FirstPartyLoginController],
    providers: [{ provide: LoginService, useValue: login }],
  })(PrivateHttpModule);
  app = await NestFactory.create(PrivateHttpModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const privateUrl = await app.getUrl();
  const vaultFills = [];
  const tools = {
    ...(await androidTools(android, undefined, (taskId, workerId) =>
      login.activateSurface(taskId, workerId, 'android'),
    )),
    ...loginTools(login),
  };
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute.bind(tool);
    tool.execute = async (args, context) => {
      console.log(JSON.stringify({ tool: name }));
      noSecrets(args);
      const result = await execute(args, context);
      if (!name.startsWith('android_')) noSecrets(result);
      if (name === 'enter_private_fields' && result.status === 'filled')
        vaultFills.push(...result.fields);
      return result;
    };
  }
  modelSession = await createMainSession({
    connectionString,
    schemaName,
    model: chatgptModel(
      'gpt-6.1-sol',
      process.env.PAL_AGENT_AUTH_PATH,
      'medium',
    ),
    memoryOptions: {
      lastMessages: 20,
      semanticRecall: false,
      workingMemory: { enabled: false },
    },
    onEvent: () => {},
    task: {
      instructions: await loadAgentInstructions('task'),
      tools: {},
      inputProcessors: [],
      publish: async (output) => {
        noSecrets(output.text);
        outputs.push(output.text);
        console.log(JSON.stringify({ result: output.text }));
      },
      worker: {
        model: chatgptModel(
          'gpt-6.1-terra',
          process.env.PAL_AGENT_AUTH_PATH,
          'medium',
        ),
        // This isolated smoke preloads the same on-demand skill bodies; role
        // discovery is covered by the existing agent-skills suite.
        instructions:
          (await loadAgentInstructions('worker')) +
          '\n' +
          (await readFile(
            'dist/agent/skills/website-authentication/SKILL.md',
            'utf8',
          )) +
          '\n' +
          (await readFile(
            'dist/agent/skills/android-interaction/SKILL.md',
            'utf8',
          )),
        tools: () => tools,
        inputProcessors: [new CodeModeProcessor()],
        resume: (taskId, assignment) => login.resumeWorker(taskId, assignment),
        cleanup: async (taskId, workerId, completed, startedAt) => {
          const retain = await login.retainWorkerSession(
            taskId,
            workerId,
            completed,
            startedAt,
          );
          await android.release(taskId, workerId, retain);
        },
      },
    },
  });
  async function runFlow(label, initialMessage) {
    const task = await tasks.create({
      title: 'Android private fill ' + label,
      goal: 'Complete staged native fixture login',
    });
    const threadId = 'pal-task:' + task.id;
    const requestContext = new RequestContext([
      [MASTRA_THREAD_ID_KEY, threadId],
      [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
    ]);
    let message = initialMessage;
    const start = seen.length;
    let authenticated = false;
    for (let turn = 0; turn < 6; turn++) {
      await tasks.update(task.id, { status: 'in-progress' });
      const delivery = await (
        await modelSession.taskAgent.sendMessage(message, {
          threadId,
          resourceId: MAIN_RESOURCE_ID,
          ifIdle: { streamOptions: { requestContext } },
        })
      ).accepted;
      assert.equal(delivery.action, 'wake');
      const timer = setTimeout(
        () => modelSession.taskAgent.abortRunStream(delivery.output.runId),
        240000,
      );
      try {
        await delivery.output.getFullOutput();
      } finally {
        clearTimeout(timer);
      }
      const pending = (await repository.active()).filter(
        (row) => row.taskId === task.id && row.status === 'pending',
      );
      if (!pending.length) {
        const view = await android.call(
          { taskId: task.id, workerId: 'acceptance-check' },
          'android_inspect',
          {},
        );
        await android.release(task.id, 'acceptance-check');
        authenticated = view.content.some(
          (e) => e.type === 'text' && e.text.includes('Authenticated'),
        );
        if (authenticated) break;
        throw new Error(
          'Model returned without a private request or authenticated fixture',
        );
      }
      assert.equal(pending.length, 1, 'One current private entry');
      const row = pending[0];
      seen.push(
        row.kind === 'code' ? 'code' : Object.keys(row.fields).join(','),
      );
      const submission =
        row.kind === 'code'
          ? { code: secret.code }
          : {
              ...Object.fromEntries(
                Object.keys(row.fields).map((role) => [role, secret[role]]),
              ),
              ...(items.length ? {} : { label: 'Synthetic native acceptance' }),
            };
      const response = await fetch(
        privateUrl +
          '/login/requests/' +
          row.id +
          (row.kind === 'code' ? '/code' : '/save'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submission),
        },
      );
      const result = await response.json();
      noSecrets(result);
      assert(response.ok, 'Actual private HTTP submission');
      assert.equal(
        result.status,
        'filled',
        'Private entry reached native field',
      );
      for (
        let attempt = 0;
        attempt < 30 &&
        !notifications.some(
          (item) =>
            item.text.includes(row.id) && item.text.includes('is filled'),
        );
        attempt++
      ) {
        await login.flushNotifications();
        await new Promise((r) => setTimeout(r, 100));
      }
      const notification = notifications.find(
        (item) => item.text.includes(row.id) && item.text.includes('is filled'),
      );
      assert(notification, 'Shared metadata notification');
      message = notification.text;
      console.log(
        JSON.stringify({ privateStage: seen.at(-1), status: result.status }),
      );
    }
    assert(
      authenticated,
      'Independently verified authenticated native fixture',
    );
    assert.deepEqual(
      seen.slice(start),
      label === 'entry' ? ['username', 'password', 'code'] : ['code'],
    );
    await tasks.update(task.id, { status: 'completed' });
    console.log(JSON.stringify({ flow: label, status: 'passed' }));
  }
  await runFlow(
    'entry',
    'Account website: https://android-fixture.example.test. Development acceptance: delegate the complete native login in dev.pal.securefixture to an interaction worker. Use Android and Pal private entry for each missing credential/code stage. Never type or request secrets in chat or ordinary tools. Verify the final Authenticated screen; keep everything inside the synthetic fixture and leave other apps alone. When private entry is awaiting, report that and yield. No scheduling/task-metadata tools exist in this test.',
  );
  await runFlow(
    'reuse',
    'Account website: https://android-fixture.example.test. Development acceptance: delegate another login in dev.pal.securefixture. It currently shows Authenticated; use Start again to begin a new fixture sign-in. Reuse the saved fixture account through enter_private_fields for username and password. Request only the new verification code through private entry. Verify Authenticated again. Use Android only, preserve other apps and never expose or type secrets through ordinary tools. Yield when private entry is awaiting.',
  );
  assert.deepEqual(privateFills, [
    ['username'],
    ['password'],
    ['code'],
    ['username'],
    ['password'],
    ['code'],
  ]);
  assert.deepEqual(vaultFills, ['username', 'password']);
  assert.equal(items.length, 1, 'Staged credentials merge into one vault item');
  assert(
    items[0].login.username === secret.username,
    'Shared vault identifier',
  );
  assert(items[0].login.password === secret.password, 'Shared vault password');
  assert(
    !JSON.stringify(items).includes(secret.code),
    'OTP stays outside vault',
  );
  const rows = await db.pool.query(
    'SELECT row_to_json(r) AS value FROM login_requests r UNION ALL SELECT row_to_json(i) FROM login_inspections i',
  );
  noSecrets(rows.rows);
  noSecrets(outputs);
  console.log(
    JSON.stringify({
      status: 'passed',
      savedReuse: true,
      stages: seen,
      privateHttp: true,
      sharedVault: true,
      authenticated: true,
      model: 'gpt-6.1-terra',
      skillLoading: 'preloaded',
      realAccountsTouched: false,
    }),
  );
} finally {
  login?.onModuleDestroy();
  await modelSession?.close();
  await android?.onApplicationShutdown();
  await channelCall({ action: 'pause' }).catch(() => {});
  await app?.close();
  vault?.onModuleDestroy();
  vaultServer.closeAllConnections();
  await new Promise((resolve) => vaultServer.close(resolve));
  await db.onApplicationShutdown();
  const pool = new Pool({ connectionString });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await pool.end();
  }
}
