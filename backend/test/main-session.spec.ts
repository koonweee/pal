import { ExecutionService } from '../dist/execution/execution.service.js';
import { LocalFilesystem, LocalSandbox } from '@mastra/core/workspace';
import { DestinationService } from '../dist/delivery/destination.service.js';
import { FilesService } from '../dist/files/files.service.js';
import { MAX_FILE_BYTES } from '../dist/files/application-file-storage.js';
import { BrowserService } from '../dist/browser/browser.service.js';
import { TaskSchedulesService } from '../dist/tasks/task-schedules.service.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceTools, WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { Pool } from 'pg';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { createTool } from '@mastra/core/tools';
import type { AgentControllerEvent } from '@mastra/core/agent-controller';
import {
  createMainSession,
  MAIN_THREAD_ID,
} from '../dist/agent/main-session.js';
import { startTestApp, until } from './helpers.js';
import { ConfigService } from '@nestjs/config';
import { McpService } from '../dist/mcp/mcp.service.js';
import { AgentAdmissionService } from '../dist/mcp/agent-admission.service.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { AgentActivityService } from '../dist/agent/agent-activity.service.js';
import { X11Computer } from '../dist/agent/x11-computer.js';
import { MastraAgentRuntime } from '../dist/agent/mastra-agent-runtime.js';
import * as providerModule from '../dist/agent/chatgpt-model.js';
import * as sessionModule from '../dist/agent/main-session.js';
import { PreferencesService } from '../dist/preferences/preferences.service.js';
import { InstanceSettingsService } from '../dist/instance-settings/instance-settings.service.js';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pal:pal@localhost:5433/pal_test';
if (!new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('Test database must end in _test');
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
const textParts = (text: string) => [
  { type: 'text-start' as const, id: 'text' },
  { type: 'text-delta' as const, id: 'text', delta: text },
  { type: 'text-end' as const, id: 'text' },
];
const publicTextParts = (text: string) =>
  textParts(JSON.stringify({ text, replyTo: null }));
let main: Awaited<ReturnType<typeof createMainSession>> | undefined;
let schema: string;
beforeEach(() => {
  schema = 'pal_test_' + randomUUID().replaceAll('-', '');
});
afterEach(async () => {
  await main?.close();
  main = undefined;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await pool.end();
  }
});

it('accepts B during A, keeps Main text private, and resumes the same thread', async () => {
  const events: AgentControllerEvent[] = [];
  const toolEntered = Promise.withResolvers<void>();
  const toolRelease = Promise.withResolvers<void>();
  let calls = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks:
          ++calls === 1
            ? [
                { type: 'reasoning-start', id: 'reason' },
                {
                  type: 'reasoning-delta',
                  id: 'reason',
                  delta: 'Private reasoning',
                },
                { type: 'reasoning-end', id: 'reason' },
                ...textParts('Working on A'),
                {
                  type: 'tool-call',
                  toolCallId: 'call',
                  toolName: 'wait',
                  input: '{}',
                },
                finish(true),
              ]
            : [
                ...publicTextParts(
                  calls === 2 ? 'Handled A and B' : 'Continued',
                ),
                finish(),
              ],
      }),
    }),
  });
  const options = {
    connectionString: databaseUrl,
    schemaName: schema,
    model,
    memoryOptions: {
      lastMessages: 100,
      semanticRecall: false,
      workingMemory: { enabled: false },
      observationalMemory: {
        model,
        scope: 'thread' as const,
        observation: { messageTokens: 100000, bufferTokens: false as const },
      },
    },
    tools: {
      wait: createTool({
        id: 'wait',
        description: 'Controlled test gate',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => {
          toolEntered.resolve();
          await toolRelease.promise;
          return { private: 'Tool result' };
        },
      }),
    },
    onEvent: (event: AgentControllerEvent) => {
      events.push(event);
    },
  };
  main = await createMainSession(options);
  await main.session.permissions.setForTool({
    toolName: 'wait',
    policy: 'allow',
  });
  try {
    await main.session.sendSignal(
      {
        type: 'user',
        contents: 'A: remember identifier PAL-42',
        attributes: { originDestinationId: 'telegram' },
      },
      { requireDelivery: true },
    ).accepted;
    await toolEntered.promise;
    await main.session.sendSignal(
      {
        type: 'user',
        contents: 'B: correction, identifier PAL-43; unfinished work remains',
        attributes: { originDestinationId: 'ios' },
      },
      { requireDelivery: true },
    ).accepted;
    expect(calls).toBe(1);
    toolRelease.resolve();
    await until(
      () => events.some((event) => event.type === 'agent_end'),
      10000,
    );
    expect(
      model.doStreamCalls.map((call) => call.headers?.['session-id']),
    ).toEqual([MAIN_THREAD_ID, MAIN_THREAD_ID]);
    expect(model.doStreamCalls[1].tools).toEqual(model.doStreamCalls[0].tools);
    expect(model.doStreamCalls[1].prompt[0].role).toBe('system');
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('PAL-42');
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain(
      'B: correction',
    );
    expect(events.filter((event) => event.type === 'agent_start')).toHaveLength(
      1,
    );
    await main.close();
    main = undefined;
    events.length = 0;
    main = await createMainSession(options);
    // A send after completion wakes the same durable conversation.
    await main.session.sendSignal(
      {
        type: 'user',
        contents: 'Continue the unfinished work',
        attributes: { originDestinationId: 'web' },
      },
      { requireDelivery: true },
    ).accepted;
    await until(
      () => events.some((event) => event.type === 'agent_end'),
      10000,
    );
    const restored = JSON.stringify(model.doStreamCalls.at(-1)?.prompt);
    expect(restored).toContain('PAL-43');
    expect(restored).toContain('Handled A and B');
    expect(model.doStreamCalls.at(-1)?.headers?.['session-id']).toBe(
      MAIN_THREAD_ID,
    );
    const starts = events.filter(
      (event) => event.type === 'agent_start',
    ).length;
    const ends = events.filter((event) => event.type === 'agent_end').length;
    await Promise.all([
      main.session.sendSignal(
        { content: 'C: first back-to-back input' },
        { requireDelivery: true },
      ).accepted,
      main.session.sendSignal(
        { content: 'D: second back-to-back input' },
        { requireDelivery: true },
      ).accepted,
    ]);
    await until(
      () =>
        events.filter((event) => event.type === 'agent_end').length > ends &&
        !main!.session.stream.isActive(),
      10000,
    );
    const delivered = JSON.stringify(
      model.doStreamCalls.slice(3).map((call) => call.prompt),
    );
    expect(delivered).toContain('C: first');
    expect(delivered).toContain('D: second');
    expect(
      events.filter((event) => event.type === 'agent_start').length,
    ).toBeGreaterThan(starts);
  } finally {
    toolRelease.resolve();
  }
});

it('keeps unfinished text private on native cancellation and releases the session', async () => {
  const events: AgentControllerEvent[] = [];
  const started = Promise.withResolvers<void>();
  const model = new MockLanguageModelV3({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 'partial' });
          controller.enqueue({
            type: 'text-delta',
            id: 'partial',
            delta: 'Unfinished private text',
          });
          started.resolve();
          abortSignal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
      }),
    }),
  });
  main = await createMainSession({
    connectionString: databaseUrl,
    schemaName: schema,
    model,
    memoryOptions: {
      lastMessages: 100,
      semanticRecall: false,
      workingMemory: { enabled: false },
    },
    onEvent: (event) => {
      events.push(event);
    },
  });
  await main.session.sendSignal({ content: 'Start' }, { requireDelivery: true })
    .accepted;
  await started.promise;
  await main.close();
  main = undefined;
  expect(
    events.some(
      (event) => event.type === 'agent_end' && event.reason === 'aborted',
    ),
  ).toBe(true);
});

it('compresses through native observation/reflection and restores the corrected identifier and unfinished task', async () => {
  const events: AgentControllerEvent[] = [];
  const actor = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [...publicTextParts('Acknowledged'), finish()],
      }),
    }),
  });
  const observations =
    'Date: Oct 6, 2026\n* 🔴 Correct identifier is PAL-43, replacing PAL-42.\n* 🔴 User still needs to finish the migration checklist.';
  const compressed =
    'Date: Oct 6, 2026\n* 🔴 Identifier PAL-43. Migration checklist remains unfinished.';
  let memoryCalls = 0;
  const memoryModel = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          ...textParts(
            `<observations>\n${++memoryCalls === 1 ? observations : compressed}\n</observations>\n<current-task>Finish the migration checklist.</current-task>`,
          ),
          finish(),
        ],
      }),
    }),
  });
  const options = {
    connectionString: databaseUrl,
    schemaName: schema,
    model: actor,
    memoryOptions: {
      lastMessages: false as const,
      semanticRecall: false,
      workingMemory: { enabled: false },
      observationalMemory: {
        model: memoryModel,
        scope: 'thread' as const,
        observation: { messageTokens: 30000, bufferTokens: false as const },
        reflection: { observationTokens: 40000 },
      },
    },
    onEvent: (event: AgentControllerEvent) => {
      events.push(event);
    },
  };
  main = await createMainSession(options);
  await main.session.sendMessage({
    content: 'Remember PAL-42. The migration checklist is unfinished.',
  });
  await main.session.sendMessage({
    content:
      'Correction: the identifier is PAL-43. Keep the unfinished migration checklist.',
  });
  const om = await main.memory.omEngine;
  expect(om).not.toBeNull();
  await om!.updateRecordConfig('pal-main', 'pal-owner', {
    observation: { messageTokens: 1 },
  });
  const observed = await om!.observe({
    threadId: 'pal-main',
    resourceId: 'pal-owner',
  });
  expect(observed.observed).toBe(true);
  await om!.updateRecordConfig('pal-main', 'pal-owner', {
    observation: { messageTokens: 30000 },
  });
  expect(JSON.stringify(memoryModel.doStreamCalls[0].prompt)).toContain(
    'Correction:',
  );
  await om!.reflect('pal-main', 'pal-owner');
  const store = await main.storage.getStore('memory');
  const record = await store!.getObservationalMemory('pal-main', 'pal-owner');
  expect(record?.generationCount).toBeGreaterThan(0);
  expect(record?.activeObservations).toContain('PAL-43');
  expect(record?.activeObservations).toContain('unfinished');
  await main.close();
  main = undefined;
  main = await createMainSession(options);
  await main.session.sendMessage({
    content: 'Continue the unfinished task using the correct identifier.',
  });
  const prompt = JSON.stringify(actor.doStreamCalls.at(-1)?.prompt);
  expect(prompt).toContain('PAL-43');
  expect(prompt).toContain('unfinished');
  expect(prompt).not.toContain('PAL-42');
});

it('keeps generation failures private, and shuts down silently', async () => {
  const fixture = await startTestApp();
  const chat = fixture.app.get(ChatService);
  const activity = fixture.app.get(AgentActivityService);
  const partialStarted = Promise.withResolvers<void>();
  let calls = 0;
  const model = new MockLanguageModelV3({
    doStream: async ({ abortSignal }) => {
      if (++calls === 1)
        return {
          stream: simulateReadableStream({
            chunks: [
              ...publicTextParts('Completed commentary'),
              { type: 'text-start', id: 'partial' },
              {
                type: 'text-delta',
                id: 'partial',
                delta: 'Private unfinished text',
              },
              { type: 'error', error: new Error('Private provider details') },
            ],
          }),
        };
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'shutdown' });
            controller.enqueue({
              type: 'text-delta',
              id: 'shutdown',
              delta: 'Private shutdown text',
            });
            partialStarted.resolve();
            abortSignal?.addEventListener(
              'abort',
              () => controller.error(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          },
        }),
      };
    },
  });
  const create = sessionModule.createMainSession;
  const sessionSpy = vi
    .spyOn(sessionModule, 'createMainSession')
    .mockImplementation((options) =>
      create({ ...options, schemaName: schema }),
    );
  const providerSpy = vi
    .spyOn(providerModule, 'chatgptModel')
    .mockReturnValue(model);
  const runtime = new MastraAgentRuntime(
    new ConfigService({
      DATABASE_URL: databaseUrl,
      PAL_AGENT_MODEL: 'fixture',
      PAL_AGENT_THINKING_EFFORT: 'medium',
      PAL_AGENT_AUTH_PATH: '/unused',
      PAL_AGENT_WORKING_DIR: fixture.uploads,
    }),
    chat,
    activity,
    fixture.app.get(TasksService),
    new TaskSchedulesService(fixture.app.get(TasksService)),
    fixture.app.get(McpService),
    fixture.app.get(AgentAdmissionService),
    fixture.app.get(BrowserService),
    fixture.app.get(FilesService),
    fixture.app.get(PreferencesService),
    fixture.app.get(DestinationService),
    fixture.app.get(InstanceSettingsService),
    fixture.app.get(ExecutionService),
  );
  try {
    await runtime.onModuleInit();
    const user = await chat.publish({
      role: 'user',
      text: 'Fail after commentary',
    });
    await runtime.submit(user);
    await until(() => calls > 0 && activity.current().status === 'idle', 10000);
    expect(activity.current().status).toBe('idle');
    const publicText = (await chat.history({})).messages
      .filter((message) => message.role === 'assistant')
      .map((message) => message.text);
    expect(publicText).toEqual([]);
    const second = await chat.publish({
      role: 'user',
      text: 'Start then shut down',
    });
    await runtime.submit(second);
    await partialStarted.promise;
    expect(activity.current().status).toBe('working');
    await runtime.beforeApplicationShutdown();
    expect(activity.current().status).toBe('idle');
    expect(
      (await chat.history({})).messages
        .filter((message) => message.role === 'assistant')
        .map((message) => message.text),
    ).toEqual(publicText);
  } finally {
    await runtime.beforeApplicationShutdown();
    sessionSpy.mockRestore();
    providerSpy.mockRestore();
    await fixture.close();
  }
});

it('exposes all supported native workspace tools, keeps results private, and stops commands on shutdown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pal-workspace-'));
  const outside = join(directory, 'outside.txt');
  const pidFile = join(directory, 'foreground.pid');
  const events: AgentControllerEvent[] = [];
  const computer = new X11Computer({ output: async () => Buffer.alloc(0) });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
    'base64',
  );
  const screenshot = vi
    .spyOn(computer, 'screenshot')
    .mockResolvedValue({ data: png, mediaType: 'image/png' });
  const filesystem = WORKSPACE_TOOLS.FILESYSTEM;
  const sandbox = WORKSPACE_TOOLS.SANDBOX;
  let backgroundPid = '';
  const operations = [
    {
      name: filesystem.WRITE_FILE,
      args: { path: outside, content: 'Private original', overwrite: true },
    },
    { name: filesystem.READ_FILE, args: { path: outside } },
    {
      name: filesystem.EDIT_FILE,
      args: { path: outside, old_string: 'original', new_string: 'edited' },
    },
    { name: filesystem.LIST_FILES, args: { path: directory } },
    {
      name: sandbox.EXECUTE_COMMAND,
      args: { command: 'node -e \'console.log("Private command output")\'' },
    },
    {
      name: sandbox.EXECUTE_COMMAND,
      args: {
        command:
          'node -e \'console.log("Private background output");setInterval(()=>{},1000)\'',
        background: true,
      },
    },
    { name: sandbox.GET_PROCESS_OUTPUT, args: () => ({ pid: backgroundPid }) },
    { name: sandbox.KILL_PROCESS, args: () => ({ pid: backgroundPid }) },
    { name: WORKSPACE_TOOLS.COMPUTER.SCREENSHOT, args: {} },
  ];
  let calls = 0;
  let cancelling = false;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      const index = calls++;
      const operation = cancelling
        ? {
            name: sandbox.EXECUTE_COMMAND,
            args: {
              command: `node -e 'require("node:fs").writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)'`,
            },
          }
        : operations[index];
      return {
        stream: simulateReadableStream({
          chunks: operation
            ? [
                {
                  type: 'tool-call',
                  toolCallId: `native-${index}`,
                  toolName: operation.name,
                  input: JSON.stringify(
                    typeof operation.args === 'function'
                      ? operation.args()
                      : operation.args,
                  ),
                },
                finish(true),
              ]
            : [...publicTextParts('Native work finished'), finish()],
        }),
      };
    },
  });
  const isGone = (pid: number) => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
  };
  try {
    main = await createMainSession({
      connectionString: databaseUrl,
      schemaName: schema,
      workingDirectory: directory,
      sandbox: new LocalSandbox({
        workingDirectory: directory,
        isolation: 'none',
      }),
      filesystem: new LocalFilesystem({ basePath: directory, contained: true }),
      computer,
      model,
      memoryOptions: {
        lastMessages: 100,
        semanticRecall: false,
        workingMemory: { enabled: false },
      },
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'tool_end' && event.toolCallId === 'native-5')
          backgroundPid = /PID: (\d+)/.exec(String(event.result))?.[1] ?? '';
      },
    });
    // Exercise the configured native reader at the upload boundary without
    // putting a large fixture into model memory or PostgreSQL.
    const mediaPath = join(directory, 'boundary.pdf');
    const mediaBytes = Buffer.alloc(MAX_FILE_BYTES, 32);
    mediaBytes.write('%PDF-1.4\n');
    await writeFile(mediaPath, mediaBytes);
    const nativeTools = await createWorkspaceTools(main.workspace!);
    const read = nativeTools[filesystem.READ_FILE];
    const media = await read.execute!({ path: mediaPath }, {});
    expect(media).toMatchObject({
      __workspaceMedia: true,
      mediaType: 'application/pdf',
    });
    expect(
      Buffer.from((media as { data: string }).data, 'base64').equals(
        mediaBytes,
      ),
    ).toBe(true);
    await writeFile(mediaPath, Buffer.concat([mediaBytes, Buffer.from(' ')]));
    expect(await read.execute!({ path: mediaPath }, {})).toContain(
      `exceeds maxMediaBytes (${MAX_FILE_BYTES})`,
    );

    await main.session.sendMessage({ content: 'Exercise the native tools' });
    expect(await readFile(outside, 'utf8')).toBe('Private edited');
    expect(screenshot).toHaveBeenCalled();
    expect(JSON.stringify(model.doStreamCalls.at(-1)?.prompt)).toContain(
      'image/png',
    );
    expect(JSON.stringify(model.doStreamCalls.at(-1)?.prompt)).toContain(
      png.toString('base64'),
    );

    expect(
      events.some((event) => event.type === 'tool_approval_required'),
    ).toBe(false);
    const results = events.filter((event) => event.type === 'tool_end');
    expect(results).toHaveLength(operations.length);
    expect(results.every((event) => !event.isError && !event.denied)).toBe(
      true,
    );
    expect(backgroundPid).not.toBe('');
    await until(() => isGone(Number(backgroundPid)));
    const tools = model.doStreamCalls[0].tools?.map((tool) => tool.name).sort();
    expect(tools).toEqual(
      Object.keys(await createWorkspaceTools(main.workspace!)).sort(),
    );
    expect(tools).toEqual(expect.arrayContaining(Object.values(sandbox)));
    expect(tools).toEqual(
      expect.arrayContaining(Object.values(WORKSPACE_TOOLS.COMPUTER)),
    );
    expect(String(results[1].result)).toContain('Private original');
    expect(String(results[3].result)).toContain('outside.txt');
    expect(String(results[4].result)).toContain('Private command output');

    // Leave a background process alive, then close Main during a foreground command.
    const handle = await main.workspace!.sandbox!.processes!.spawn(
      "node -e 'setInterval(()=>{},1000)'",
    );
    cancelling = true;
    await main.session.sendSignal(
      { content: 'Run until cancelled' },
      { requireDelivery: true },
    ).accepted;
    await until(async () => {
      try {
        await readFile(pidFile);
        return true;
      } catch {
        return false;
      }
    });
    const foregroundPid = Number(await readFile(pidFile, 'utf8'));
    await main.close();
    main = undefined;
    await until(() => isGone(foregroundPid) && isGone(Number(handle.pid)));
  } finally {
    await main?.close();
    main = undefined;
    await rm(directory, { recursive: true, force: true });
  }
});
