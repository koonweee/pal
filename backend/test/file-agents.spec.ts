import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import request from 'supertest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { createTool } from '@mastra/core/tools';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import type { GeneratedFile } from '../dist/agent/public-output.js';
import { MastraAgentRuntime } from '../dist/agent/mastra-agent-runtime.js';
import { AGENT_RUNTIME } from '../dist/agent/agent-runtime.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { TaskSchedulesService } from '../dist/tasks/task-schedules.service.js';
import { startTestApp, until } from './helpers.js';
import * as sessions from '../dist/agent/main-session.js';
import * as providers from '../dist/agent/chatgpt-model.js';

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
const call = (toolName: string, input: object) => ({
  type: 'tool-call' as const,
  toolCallId: randomUUID(),
  toolName,
  input: JSON.stringify(input),
});
const text = (
  value: string,
  attachmentIds: string[] = [],
  id = 'text',
  files: GeneratedFile[] = [],
  notify: boolean | null = null,
) => [
  {
    type: 'text-start' as const,
    id,
    providerMetadata: { openai: { phase: 'final_answer' } },
  },
  {
    type: 'text-delta' as const,
    id,
    delta: JSON.stringify({
      text: value,
      replyTo: null,
      attachmentIds,
      files,
      notify,
    }),
  },
  {
    type: 'text-end' as const,
    id,
    providerMetadata: { openai: { phase: 'final_answer' } },
  },
];

it('carries file paths through native input/delegation and publishes file-only outputs during active follow-ups', async () => {
  const schemaName = 'pal_files_' + randomUUID().replaceAll('-', '');
  const gate = Promise.withResolvers<void>();
  let entered = false;
  let inputId = '';
  let inputPath = '';
  let outputPath = '';
  let selectedId = '';
  let selectedPath = '';
  let taskCalls = 0;
  let mainCalls = 0;
  let currentRef = 1;
  const invalidId = randomUUID();
  const model = new MockLanguageModelV3({
    doStream: async ({ prompt, headers, tools, responseFormat }) => {
      if (responseFormat)
        expect(responseFormat).not.toHaveProperty('schema.properties.notify');
      const context = JSON.stringify(prompt);
      const task = headers?.['session-id']?.startsWith('pal-task:');
      let chunks;
      if (!task) {
        mainCalls++;
        if (mainCalls === 1) {
          expect(context).toContain(inputPath);
          expect(tools?.map((tool) => tool.name)).toContain(
            WORKSPACE_TOOLS.FILESYSTEM.READ_FILE,
          );
          expect(tools?.map((tool) => tool.name)).not.toContain(
            WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE,
          );
          expect(tools?.map((tool) => tool.name)).not.toContain(
            WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND,
          );
          chunks = [
            call(WORKSPACE_TOOLS.FILESYSTEM.READ_FILE, { path: inputPath }),
            finish(true),
          ];
        } else if (mainCalls === 2) {
          expect(context).toContain('Uploaded contents');
          chunks = [
            call('delegate_task', {
              title: 'File processing',
              goal: 'Prepare report',
              message: 'Process files',
              sourceMessageRefs: [1],
              attachmentIds: [selectedId],
            }),
            finish(true),
          ];
        } else chunks = [finish()];
      } else {
        switch (++taskCalls) {
          case 1:
            expect(context).toContain(inputPath);
            expect(context).toContain(inputId);
            expect(context).toContain(selectedPath);
            chunks = [call('file_gate', {}), finish(true)];
            break;
          case 2:
            expect(context).toContain('Follow-up with files');
            expect(await readFile(inputPath, 'utf8')).toBe('Uploaded contents');
            chunks = [
              call('inspect_message', { messageRef: currentRef }),
              finish(true),
            ];
            break;
          case 3: {
            const inspection = prompt
              .flatMap((item) => (item.role === 'tool' ? item.content : []))
              .find(
                (part) =>
                  part.type === 'tool-result' &&
                  part.toolName === 'inspect_message',
              );
            expect(inspection).toMatchObject({
              output: {
                type: 'json',
                value: { attachments: [{ id: inputId, path: inputPath }] },
              },
            });
            chunks = [
              ...text('Bad output path', [], 'invalid-file', [
                {
                  path: join(outputPath, 'missing'),
                  filename: 'report.txt',
                  contentType: 'text/plain',
                },
              ]),
              finish(),
            ];
            break;
          }
          case 4:
            expect(context).toContain('File is not readable');
            chunks = [
              call('inspect_message', { messageRef: currentRef }),
              finish(true),
            ];
            break;
          case 5:
            chunks = [
              ...text('', [inputId], 'text', [
                {
                  path: outputPath,
                  filename: 'report.txt',
                  contentType: 'text/plain',
                },
              ]),
              ...text(
                'Useful answer despite missing file',
                [invalidId],
                'still-invalid',
                [],
                false,
              ),
              finish(),
            ];
            break;
          default:
            chunks = [finish()];
        }
      }
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  const create = sessions.createMainSession;
  const sessionSpy = vi
    .spyOn(sessions, 'createMainSession')
    .mockImplementation((options) =>
      create({
        ...options,
        schemaName,
        memoryOptions: {
          lastMessages: 100,
          semanticRecall: false,
          workingMemory: { enabled: false },
        },
        task: options.task
          ? {
              ...options.task,
              tools: async (context) => ({
                ...(typeof options.task!.tools === 'function'
                  ? await options.task!.tools(context)
                  : options.task!.tools),
                file_gate: createTool({
                  id: 'file_gate',
                  description: 'Hold task for active input',
                  inputSchema: { type: 'object', properties: {} },
                  execute: async () => {
                    entered = true;
                    await gate.promise;
                    return { ready: true };
                  },
                }),
              }),
            }
          : undefined,
      }),
    );
  const providerSpy = vi
    .spyOn(providers, 'chatgptModel')
    .mockReturnValue(model);
  let fixture: Awaited<ReturnType<typeof startTestApp>> | undefined;
  try {
    fixture = await startTestApp({
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
            PAL_AGENT_WORKING_DIR: config.PAL_UPLOAD_DIR,
          }),
          chat,
          activity,
          tasks,
          new TaskSchedulesService(tasks),
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
    const uploaded = await request(fixture.url)
      .post('/files')
      .attach('file', Buffer.from('Uploaded contents'), 'input.txt')
      .expect(201);
    inputId = uploaded.body.attachment.id;
    const selected = await request(fixture.url)
      .post('/files')
      .attach('file', Buffer.from('Selected earlier file'), 'selected.txt')
      .expect(201);
    selectedId = selected.body.attachment.id;
    outputPath = join(fixture.uploads, 'output.txt');
    await writeFile(outputPath, 'Generated report');
    // Resolve the private path exactly as production does.
    const { FilesService } = await import('../dist/files/files.service.js');
    inputPath = (await fixture.app.get(FilesService).manifest([inputId]))[0]
      .path;
    selectedPath = (
      await fixture.app.get(FilesService).manifest([selectedId])
    )[0].path;
    await request(fixture.url)
      .post('/chat/messages')
      .send({
        destinationId: 'ios',
        idempotencyKey: randomUUID(),
        text: '',
        attachmentIds: [inputId],
      })
      .expect(201);
    await until(() => entered, 10000);
    const task = (await fixture.app.get(TasksService).list({})).tasks[0];
    const followup = await request(fixture.url)
      .post('/chat/messages')
      .send({
        destinationId: 'ios',
        idempotencyKey: randomUUID(),
        text: 'Follow-up with files',
        taskId: task.id,
        attachmentIds: [inputId],
      })
      .expect(201);
    currentRef = (
      await fixture.app.get(ChatService).get(followup.body.messageId)
    ).sequence;
    gate.resolve();
    const chat = fixture.app.get(ChatService);
    await until(
      async () =>
        (await chat.history({ taskId: task.id })).messages.some(
          (message) =>
            message.role === 'assistant' && message.attachments.length === 2,
        ),
      10000,
    );
    const output = (await chat.history({ taskId: task.id })).messages.find(
      (message) => message.role === 'assistant' && message.attachments.length,
    )!;
    expect(output.text).toBe('');
    expect(output.phase).toBe('final_answer');
    const download = await request(fixture.url)
      .get(`/files/${output.attachments[1].id}/download`)
      .expect(200);
    expect(download.body.toString()).toBe('Generated report');
    expect(output.attachments[0].id).toBe(inputId);
    await writeFile(outputPath, 'Changed after delivery');
    const unchanged = await request(fixture.url)
      .get(`/files/${output.attachments[1].id}/download`)
      .expect(200);
    expect(unchanged.body.toString()).toBe('Generated report');
    expect(JSON.stringify(output)).not.toContain(outputPath);
    expect(
      model.doStreamCalls.flatMap(
        (call) => call.tools?.map((tool) => tool.name) ?? [],
      ),
    ).not.toContain('prepare_attachment');
    expect(
      (await chat.history({ taskId: task.id })).messages.some(
        (message) => message.text === 'Bad output path',
      ),
    ).toBe(false);
    // Let the attachment retry finish before shutdown cancels active work.
    await until(
      async () =>
        (await chat.history({ taskId: task.id })).messages.some((message) =>
          message.text.includes('could not attach'),
        ),
      10000,
    );
    const runtime = fixture.app.get<MastraAgentRuntime>(AGENT_RUNTIME);
    await runtime.beforeApplicationShutdown();
    expect(
      await fixture.app.get(TasksService).details(task.id),
    ).not.toHaveProperty('attachments');
    expect(
      (await chat.history({ taskId: task.id })).messages.some((message) =>
        message.text.includes('could not attach'),
      ),
    ).toBe(true);
    expect(
      (await chat.history({ taskId: task.id })).messages.find((message) =>
        message.text.includes('could not attach'),
      )?.text,
    ).toBe(
      'Useful answer despite missing file\n\nI could not attach those files. Please ask me to send them again.',
    );
    expect(
      (await chat.history({ taskId: task.id })).messages.find((message) =>
        message.text.includes('could not attach'),
      )?.notify,
    ).toBe(false); // Task logs do not create notification intent.
    expect(taskCalls).toBe(5);
  } finally {
    gate.resolve();
    await fixture?.close();
    sessionSpy.mockRestore();
    providerSpy.mockRestore();
    const pool = new Pool({
      connectionString:
        process.env.TEST_DATABASE_URL ??
        'postgresql://pal:pal@localhost:5433/pal_test',
    });
    try {
      await pool.query('DROP SCHEMA IF EXISTS "' + schemaName + '" CASCADE');
    } finally {
      await pool.end();
    }
  }
}, 40000);
