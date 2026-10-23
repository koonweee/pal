import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { ApplicationError } from '../dist/application/contracts/errors.js';
import { Workspace, LocalSandbox } from '@mastra/core/workspace';
import { createCodeModeTool, noopObserve } from '@mastra/core/tools';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { startTestApp, until } from './helpers.js';
import * as sessions from '../dist/agent/main-session.js';
import * as providers from '../dist/agent/chatgpt-model.js';
import { MastraAgentRuntime } from '../dist/agent/mastra-agent-runtime.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { TaskSchedulesService } from '../dist/tasks/task-schedules.service.js';
import { startMcpFixture } from './mcp-fixture.js';
import { McpService } from '../dist/mcp/mcp.service.js';
import { McpRepository } from '../dist/mcp/mcp.repository.js';
import { AgentAdmissionService } from '../dist/mcp/agent-admission.service.js';
import { catalogDiagnostics } from '../dist/mcp/catalog-diagnostics.js';

it('persists redacted configuration and OAuth, refreshes credentials, and executes native task code mode', async () => {
  const app = await startTestApp();
  const remote = await startMcpFixture();
  const directory = await mkdtemp(join(tmpdir(), 'pal-mcp-'));
  const workspace = new Workspace({
    sandbox: new LocalSandbox({
      workingDirectory: directory,
      isolation: 'none',
    }),
  });
  let replacement: McpService | undefined;
  try {
    const config = app.app.get(ConfigService);
    config.set('PAL_PUBLIC_URL', app.url);
    const service = app.app.get(McpService);
    const saved = await request(app.url)
      .post('/mcp/servers')
      .send({
        name: 'fixture',
        url: remote.origin + '/mcp',
        auth: {
          type: 'oauth',
          clientId: 'fixture-client',
          clientSecret: 'fixture-secret',
          scope: 'service:read service:write offline_access',
        },
      })
      .expect(201);
    const id = saved.body.id as string;
    const snapshot = await request(app.url).get('/mcp/servers').expect(200);
    expect(JSON.stringify(snapshot.body)).not.toContain('fixture-secret');
    expect(snapshot.body.servers[0].auth.hasClientSecret).toBe(true);
    await request(app.url)
      .patch(`/mcp/servers/${id}`)
      .send({
        auth: {
          type: 'oauth',
          scope: 'service:read service:write offline_access',
        },
      })
      .expect(200);
    await request(app.url).post('/mcp/apply').expect(201);
    expect((await service.list()).servers[0].status.state).toBe('needs-auth');
    const login = await request(app.url)
      .post(`/mcp/servers/${id}/login`)
      .expect(201);
    const authorizationUrl = new URL(login.body.authorizationUrl as string);
    expect(authorizationUrl.searchParams.get('scope')).toBe(
      'service:read service:write offline_access',
    );
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    await request(app.url).post(`/mcp/servers/${id}/login`).expect(409);
    await request(app.url)
      .get('/mcp/oauth/callback?state=wrong&code=fixture-code')
      .expect(400);
    const authorize = await fetch(authorizationUrl, { redirect: 'manual' });
    const callback = new URL(authorize.headers.get('location')!);
    await request(app.url)
      .get(callback.pathname + callback.search)
      .expect(200);
    await request(app.url)
      .get(callback.pathname + callback.search)
      .expect(400);
    expect((await service.list()).servers[0].hasLogin).toBe(true);
    expect((await service.list()).applyNeeded).toBe(true);
    await request(app.url).post('/mcp/apply').expect(201);
    expect((await service.list()).servers[0].status).toMatchObject({
      state: 'connected',
      toolCount: 4,
    });
    await workspace.init();
    const run = (code: string) =>
      createCodeModeTool({ tools: service.tools() }).execute!(
        { code },
        { workspace, observe: noopObserve },
      );
    const output = await run(
      'return {data: await external_fixture_lookup({}), text: await external_fixture_text({}), write: await external_fixture_write({value: 7}), failure: await external_fixture_fails({})};',
    );
    expect(output).toMatchObject({
      success: true,
      result: {
        data: { balance: 42 },
        text: { content: [{ text: 'ordinary text' }] },
        write: { content: [{ text: 'saved 7' }] },
        failure: { isError: true },
      },
    });
    remote.changeCatalog();
    await service.apply();
    expect(service.tools()).toHaveProperty('fixture_lookup_new');
    expect(service.instructions()).not.toContain('external_fixture_');
    expect(
      await run('return await external_fixture_lookup_new({});'),
    ).toMatchObject({ success: true, result: { balance: 42 } });
    remote.rotateRefreshTokens();
    remote.expireToken();
    const refreshAttempts = remote.refreshAttempts;
    const concurrent = await Promise.all(
      Array.from({ length: 7 }, () =>
        run('return await external_fixture_lookup_new({});'),
      ),
    );
    expect(concurrent).toMatchObject(
      Array.from({ length: 7 }, () => ({
        success: true,
        result: { balance: 42 },
      })),
    );
    expect(remote.refreshAttempts - refreshAttempts).toBe(1);
    expect((await service.list()).servers[0].hasLogin).toBe(true);
    // The SDK refreshes after the resource server rejects an expired token.
    const repository = app.app.get(McpRepository);
    const row = (await repository.get(id))!;
    await service.onApplicationShutdown();
    replacement = new McpService(
      repository,
      config,
      new AgentAdmissionService(),
    );
    await replacement.load();
    expect((await replacement.list()).servers[0].status.state).toBe(
      'connected',
    );
    expect(remote.refreshes).toBeGreaterThan(0);
    expect(remote.advertisedApps).toBe(false);
    const redacted = JSON.stringify(await replacement.list());
    for (const secret of [
      'fixture-secret',
      'fixture-access',
      'fixture-refresh',
    ])
      expect(redacted).not.toContain(secret);
    await service.forget(id);
    await repository
      .storage(id, row.authEpoch)
      .set('tokens', '{"access_token":"stale"}');
    expect((await repository.get(id))!.oauth).toEqual({});
    expect((await service.list()).applyNeeded).toBe(true);
    await request(app.url).delete(`/mcp/servers/${id}`).expect(200);
    expect((await service.list()).servers).toEqual([]);
  } finally {
    await replacement?.onApplicationShutdown();
    await workspace.stop();
    await app.close();
    await remote.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('retries transient startup discovery before publishing the catalog', async () => {
  const app = await startTestApp();
  const remote = await startMcpFixture();
  try {
    const service = app.app.get(McpService);
    await service.save({ name: 'flaky', url: remote.origin + '/flaky' });
    remote.failConnections(2);
    const previousCatalog = service.instructions();
    const loading = service.loadAtStartup([100]);
    await until(() => remote.failedConnections === 2);
    expect(service.instructions()).toBe(previousCatalog);
    const snapshot = await loading;
    expect(remote.failedConnections).toBe(2);
    expect(snapshot.servers[0].status).toMatchObject({
      state: 'connected',
      toolCount: 4,
    });
    expect(service.tools()).toHaveProperty('flaky_lookup');
  } finally {
    await app.close();
    await remote.close();
  }
});

it('isolates broken servers and rejects busy Apply without replacing the catalog', async () => {
  const app = await startTestApp();
  const remote = await startMcpFixture();
  try {
    const service = app.app.get(McpService);
    const admission = app.app.get(AgentAdmissionService);
    await service.save({
      name: 'good',
      url: remote.origin + '/public',
      auth: { type: 'headers', headers: { 'X-Private': 'private-header' } },
    });
    await service.save({ name: 'broken', url: remote.origin + '/missing' });
    await service.save({
      name: 'collision',
      url: remote.origin + '/collision',
    });
    const snapshot = await service.apply();
    expect(
      snapshot.servers.find((server) => server.name === 'good')!.status.state,
    ).toBe('connected');
    expect(
      snapshot.servers.find((server) => server.name === 'broken')!.status.state,
    ).toBe('error');
    expect(
      snapshot.servers.find((server) => server.name === 'collision')!.status,
    ).toMatchObject({ state: 'error', toolCount: 0 });
    expect(JSON.stringify(snapshot)).not.toContain('private-header');
    const catalog = service.instructions();
    let busy = true;
    admission.bind(() => busy);
    await request(app.url).post('/mcp/apply').expect(409);
    expect(service.instructions()).toBe(catalog);
    busy = false;
    await admission.prepareSchedule('pending-wake');
    await request(app.url).post('/mcp/apply').expect(409);
    admission.finishSchedule('pending-wake');
    let entered = false;
    let release!: () => void;
    const applying = admission.apply(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const dispatch = admission.dispatch(async () => {
      entered = true;
    });
    await request(app.url).post('/mcp/apply').expect(409);
    expect(entered).toBe(false);
    release();
    await applying;
    await dispatch;
    expect(entered).toBe(true);
    await request(app.url).post('/mcp/apply').expect(201);
    await request(app.url).get('/chat/history').expect(200);
    const repository = app.app.get(McpRepository);
    const failedWrite = vi
      .spyOn(repository, 'create')
      .mockRejectedValueOnce(
        new Error('SQL parameters contain private-secret'),
      );
    const failure = await request(app.url)
      .post('/mcp/servers')
      .send({
        name: 'save_error',
        url: remote.origin + '/public',
        auth: {
          type: 'headers',
          headers: { Authorization: 'Bearer private-secret' },
        },
      })
      .expect(503);
    expect(JSON.stringify(failure.body)).not.toContain('private-secret');
    failedWrite.mockRestore();
  } finally {
    await app.close();
    await remote.close();
  }
});

it('warns only above the configured catalog percentage and reports unknown context explicitly', () => {
  expect(
    catalogDiagnostics('x'.repeat(400), 'configured-model', 3, 1000, 10),
  ).toMatchObject({ estimatedTokens: 100, percent: 10, warning: false });
  expect(
    catalogDiagnostics('x'.repeat(404), 'configured-model', 3, 1000, 10),
  ).toMatchObject({ estimatedTokens: 101, warning: true });
  expect(
    catalogDiagnostics('x'.repeat(404), 'configured-model', 3, 1000, 20)
      .warning,
  ).toBe(false);
  expect(
    catalogDiagnostics('catalog', 'unknown-model', 3, undefined, 10),
  ).toMatchObject({ contextWindowTokens: null, percent: null, warning: false });
});

it('keeps Main catalog-free and refreshes code mode for reused and scheduled task runs', async () => {
  const remote = await startMcpFixture();
  const directory = await mkdtemp(join(tmpdir(), 'pal-mcp-agent-'));
  const schema = 'mcp_agent_' + randomUUID().replaceAll('-', '');
  let mainCalls = 0;
  let taskCalls = 0;
  let searches = 0;
  let expectingCodeResult = false;
  let schedules: TaskSchedulesService;
  const mainPrompts: string[] = [];
  const finish = (tool = false) => ({
    type: 'finish' as const,
    finishReason: {
      unified: tool ? ('tool-calls' as const) : ('stop' as const),
      raw: undefined,
    },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
  });
  const text = (value: string, phase = 'final_answer') => [
    {
      type: 'text-start' as const,
      id: 'text',
      providerMetadata: { openai: { phase } },
    },
    {
      type: 'text-delta' as const,
      id: 'text',
      delta: JSON.stringify({ text: value, replyTo: null }),
    },
    {
      type: 'text-end' as const,
      id: 'text',
      providerMetadata: { openai: { phase } },
    },
  ];
  const call = (name: string, input: object) => ({
    type: 'tool-call' as const,
    toolCallId: randomUUID(),
    toolName: name,
    input: JSON.stringify(input),
  });
  const model = new MockLanguageModelV3({
    doStream: async ({ prompt, tools }) => {
      const context = JSON.stringify(prompt);
      const task = context.includes('You are the task agent');
      if (!task) {
        mainPrompts.push(context);
        expect(tools?.map((tool) => tool.name)).not.toContain(
          'execute_typescript',
        );
        expect(tools?.map((tool) => tool.name)).not.toContain('search_tools');
        return {
          stream: simulateReadableStream({
            chunks:
              ++mainCalls === 1
                ? [
                    ...text('checking that', 'commentary'),
                    call('delegate_task', {
                      title: 'Fixture lookup',
                      goal: 'Check fixture balance',
                      message: 'Read the fixture balance',
                    }),
                    finish(true),
                  ]
                : [...text(''), finish()],
          }),
        };
      }
      ++taskCalls;
      const names = tools?.map((tool) => tool.name) ?? [];
      expect(names).toContain('execute_typescript');
      expect(names).toContain('search_tools');
      expect(names).not.toContain('load_tool');
      const lookup = names.find((name) => name.startsWith('fixture_lookup'));
      if (!lookup) {
        ++searches;
        const system = prompt.filter((message) => message.role === 'system');
        expect(JSON.stringify(system)).not.toContain('external_fixture_lookup');
        return {
          stream: simulateReadableStream({
            chunks: [
              call('search_tools', { query: 'fixture lookup' }),
              finish(true),
            ],
          }),
        };
      }
      const toolTurn = !expectingCodeResult;
      expectingCodeResult = toolTurn;
      if (toolTurn) expect(context).toContain('external_' + lookup);
      return {
        stream: simulateReadableStream({
          chunks: toolTurn
            ? [
                call('execute_typescript', {
                  code: `await external_update_task({description: "Checked through general code mode"}); return await external_${lookup}({});`,
                }),
                finish(true),
              ]
            : [...text('fixture balance is 42'), finish()],
        }),
      };
    },
  });
  const original = sessions.createMainSession;
  let native: Awaited<ReturnType<typeof original>> | undefined;
  const sessionSpy = vi
    .spyOn(sessions, 'createMainSession')
    .mockImplementation(async (options) => {
      native = await original({
        ...options,
        schemaName: schema,
        memoryOptions: {
          lastMessages: 30,
          semanticRecall: false,
          workingMemory: { enabled: false },
        },
      });
      return native;
    });
  const providerSpy = vi
    .spyOn(providers, 'chatgptModel')
    .mockReturnValue(model);
  let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
  try {
    app = await startTestApp({
      runtimeFactory: ({
        chat,
        activity,
        tasks,
        config,
        mcp,
        admission,
        browser,
        login,
        files,
        preferences,
        destinations,
        instanceSettings,
        execution,
      }) =>
        new MastraAgentRuntime(
          new ConfigService({
            ...config,
            PAL_AGENT_MODEL: 'fixture',
            PAL_AGENT_AUTH_PATH: '/unused',
            PAL_AGENT_THINKING_EFFORT: 'medium',
            PAL_AGENT_WORKING_DIR: directory,
          }),
          chat,
          activity,
          tasks,
          (schedules = new TaskSchedulesService(tasks)),
          mcp,
          admission,
          browser,
          login,
          files,
          preferences,
          destinations,
          instanceSettings,
          execution,
        ),
    });
    const service = app.app.get(McpService);
    await service.save({ name: 'fixture', url: remote.origin + '/public' });
    await service.apply();
    await request(app.url)
      .post('/chat/messages')
      .send({
        text: 'Read the external fixture balance',
        idempotencyKey: randomUUID(),
        attachmentIds: [],
      })
      .expect(201);
    const chat = app.app.get(ChatService);
    await until(
      async () => (await app.app.get(TasksService).list({})).tasks.length > 0,
    );
    const taskId = (await app.app.get(TasksService).list({})).tasks[0].id;
    await until(async () =>
      (await chat.history({ taskId, limit: 10 })).messages.some(
        (message) => message.text === 'fixture balance is 42',
      ),
    );
    await until(
      () =>
        !native!.session.stream.isActive() &&
        native!.taskAgent!.listActiveThreadRuns().length === 0,
    );
    const history = await chat.history({ taskId, limit: 10 });
    expect(
      history.messages.some(
        (message) =>
          message.text === 'checking that' && message.phase === 'commentary',
      ),
    ).toBe(false);
    const answer = history.messages.find((message) => message.taskId)!;
    expect(
      (await app.app.get(TasksService).details(answer.taskId!)).title,
    ).toBe('Fixture lookup');
    expect(
      (await app.app.get(TasksService).details(answer.taskId!)).description,
    ).toBe('Checked through general code mode');
    for (const prompt of mainPrompts) {
      expect(prompt).not.toContain('external_fixture_');
      expect(prompt).not.toContain('Fixture service.');
    }
    expect(remote.toolCalls).toBe(1);
    remote.changeCatalog();
    await until(async () => {
      try {
        await service.apply();
        return true;
      } catch (error) {
        if (error instanceof ApplicationError && error.code === 'conflict')
          return false;
        throw error;
      }
    });
    await request(app.url)
      .post('/chat/messages')
      .send({
        text: 'Check again',
        taskId: answer.taskId,
        idempotencyKey: randomUUID(),
        attachmentIds: [],
      })
      .expect(201);
    await until(() => remote.toolCalls === 2);
    await until(() => native!.taskAgent!.listActiveThreadRuns().length === 0);
    expect(taskCalls).toBe(6);
    expect(searches).toBe(2);
    const scheduled = await schedules!.create(answer.taskId!, {
      cron: '0 0 1 1 *',
      timezone: 'UTC',
      prompt: 'Read the fixture balance again',
    });
    const scheduleStore = (await native!.storage.getStore('schedules'))!;
    await scheduleStore.updateSchedule(scheduled.id, {
      nextFireAt: Date.now() - 1000,
    });
    await native!.mastra.scheduler!.tick();
    await until(
      async () =>
        (
          await chat.history({ taskId: answer.taskId!, limit: 10 })
        ).messages.filter((message) => message.text === 'fixture balance is 42')
          .length === 3,
    );
    await schedules!.pause(answer.taskId!, scheduled.id);
    expect(remote.toolCalls).toBe(3);
    expect(taskCalls).toBe(8);
    expect(searches).toBe(2);
    await until(async () => {
      try {
        await service.apply();
        return true;
      } catch (error) {
        if (error instanceof ApplicationError && error.code === 'conflict')
          return false;
        throw error;
      }
    });
    const taskHistory = await chat.history({
      taskId: answer.taskId!,
      limit: 10,
    });
    expect(
      taskHistory.messages.filter(
        (message) => message.text === 'fixture balance is 42',
      ),
    ).toHaveLength(3);
    expect((await app.app.get(TasksService).list({})).tasks).toHaveLength(1);
  } finally {
    await app?.close();
    sessionSpy.mockRestore();
    providerSpy.mockRestore();
    await remote.close();
    await rm(directory, { recursive: true, force: true });
    if (process.env.DATABASE_URL) {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
    }
  }
});
