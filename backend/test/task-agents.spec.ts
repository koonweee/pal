import { LoginService } from '../dist/login/login.service.js';
import { ExecutionService } from '../dist/execution/execution.service.js';
import { DestinationService } from '../dist/delivery/destination.service.js';
import { FilesService } from '../dist/files/files.service.js';
import { BrowserService } from '../dist/browser/browser.service.js';
import { TaskSchedulesService } from '../dist/tasks/task-schedules.service.js';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import request from 'supertest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { createTool } from '@mastra/core/tools';
import { createSignal } from '@mastra/core/agent';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { AgentActivityService } from '../dist/agent/agent-activity.service.js';
import { McpService } from '../dist/mcp/mcp.service.js';
import { AgentAdmissionService } from '../dist/mcp/agent-admission.service.js';
import { MastraAgentRuntime } from '../dist/agent/mastra-agent-runtime.js';
import { PreferencesService } from '../dist/preferences/preferences.service.js';
import { InstanceSettingsService } from '../dist/instance-settings/instance-settings.service.js';
import { AGENT_RUNTIME } from '../dist/agent/agent-runtime.js';
import * as sessions from '../dist/agent/main-session.js';
import * as providers from '../dist/agent/chatgpt-model.js';
import { startTestApp, until } from './helpers.js';

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
const text = (
  value: string | string[],
  phase?: string,
  replyTo: number | null = null,
) => [
  {
    type: 'text-start' as const,
    id: 'text',
    providerMetadata: { openai: { phase: phase ?? null } },
  },
  {
    type: 'text-delta' as const,
    id: 'text',
    delta: JSON.stringify({ text: value, replyTo }),
  },
  {
    type: 'text-end' as const,
    id: 'text',
    providerMetadata: { openai: { phase: phase ?? null } },
  },
];
const call = (name: string, input: object) => ({
  type: 'tool-call' as const,
  toolCallId: randomUUID(),
  toolName: name,
  input: JSON.stringify(input),
});

it('delegates, steers isolated tasks, reports local finals to Main, and recalls context after restart', async () => {
  const schemaName = 'pal_tasks_' + randomUUID().replaceAll('-', '');
  const gate = Promise.withResolvers<void>();
  const scheduleGate = Promise.withResolvers<void>();
  let holdScheduledGate = true;
  let alphaCalls = 0;
  let gateEntered = false;
  let mainGateEntered = false;
  const mainGate = Promise.withResolvers<void>();
  let betaCalls = 0;
  let mainCalls = 0;
  const sentResults = new Set<string>();
  const send = (value: string | string[]) =>
    call('sendToUser', {
      destinationIds: [],
      notify: true,
      content: {
        kind: 'message',
        message: { text: value, replyTo: null, attachmentIds: [], files: [] },
      },
    });
  let mainInputRef = 0;
  let quietCheck = false;
  let checkEntered = false;
  let failCheck = false;
  const quietGate = Promise.withResolvers<void>();
  let schedules: TaskSchedulesService;
  const taskPrompts: string[] = [];
  const mainPrompts: string[] = [];
  const model = new MockLanguageModelV3({
    doStream: async ({ prompt, providerOptions }) => {
      const context = JSON.stringify(prompt);
      const isTask = context.includes('You are the task agent');
      let chunks;
      if (!isTask) {
        expect(providerOptions?.openai?.parallelToolCalls).not.toBe(false);
        mainPrompts.push(context);
        chunks =
          ++mainCalls === 1
            ? [
                call('sendToUser', {
                  destinationIds: [],
                  notify: false,
                  content: { kind: 'reaction', messageRef: 1, emoji: '👀' },
                }),
                send(['Starting Alpha', 'Main acknowledgement']),
                call('delegate_task', {
                  title: 'Alpha tickets',
                  goal: 'Find ALPHA-42',
                  sourceMessageRefs: [1],
                  message:
                    'Remember ALPHA-42 and check tickets. Timezone: Asia/Singapore',
                }),
                finish(true),
              ]
            : context.includes('Keep Main active') && !mainGateEntered
              ? [call('main_gate', {}), finish(true)]
              : (() => {
                  const result = [
                    'Beta final',
                    'Alpha final ALPHA-43',
                    'Alpha next steps',
                    'I could not complete that scheduled check.',
                    'Alpha continued ALPHA-43',
                  ].find(
                    (value) =>
                      context.includes(value) && !sentResults.has(value),
                  );
                  if (!result) return [finish()];
                  sentResults.add(result);
                  return [send(result), finish(true)];
                })();
      } else {
        taskPrompts.push(context);
        if (quietCheck && !context.includes('Beta tickets')) {
          if (failCheck)
            return {
              stream: new ReadableStream({
                start(controller) {
                  controller.error(
                    new Error('Private scheduled provider error'),
                  );
                },
              }),
            };
          chunks = checkEntered
            ? [finish()]
            : [call('quiet_gate', {}), finish(true)];
        } else if (context.includes('Beta tickets')) {
          chunks =
            ++betaCalls === 1
              ? [call('set_task_status', { status: 'completed' }), finish(true)]
              : [...text('Beta final', 'final_answer'), finish()];
        } else {
          // Exercise more than the direct Agent's five-step default before the final.
          const n = ++alphaCalls;
          chunks =
            n === 1
              ? [
                  ...text('Alpha commentary', 'commentary'),
                  call('gate', {}),
                  finish(true),
                ]
              : n === 2
                ? [
                    call('update_task', {
                      title: null,
                      goal: 'Find ALPHA-43',
                      description: 'Look for ALPHA-43 tickets.',
                    }),
                    call('set_task_status', { status: 'needs-input' }),
                    finish(true),
                  ]
                : n === 3
                  ? [
                      call('create_task_schedule', {
                        cron: '0 0 1 1 *',
                        timezone: 'Asia/Singapore',
                        prompt:
                          'AUTOMATION-CHECK: check ALPHA-43 quietly if unchanged',
                      }),
                      finish(true),
                    ]
                  : n <= 6
                    ? [call('gate', {}), finish(true)]
                    : n === 7
                      ? [
                          ...text(
                            ['Alpha final ALPHA-43', 'Alpha next steps'],
                            'final_answer',
                            mainInputRef,
                          ),
                          finish(),
                        ]
                      : [
                          ...text('Alpha continued ALPHA-43', 'final_answer'),
                          finish(),
                        ];
        }
      }
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  const create = sessions.createMainSession;
  const created: Awaited<ReturnType<typeof create>>[] = [];
  const sessionSpy = vi
    .spyOn(sessions, 'createMainSession')
    .mockImplementation((options) =>
      create({
        ...options,
        schemaName,
        workingDirectory: undefined,
        tools: {
          ...(typeof options.tools === 'function' ? {} : options.tools),
          main_gate: createTool({
            id: 'main_gate',
            description: 'Hold Main for active result delivery',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => {
              mainGateEntered = true;
              await mainGate.promise;
              return { done: true };
            },
          }),
        },
        memoryOptions: {
          lastMessages: 100,
          semanticRecall: false,
          workingMemory: { enabled: false },
          observationalMemory: {
            model,
            scope: 'thread' as const,
            observation: {
              messageTokens: 100000,
              bufferTokens: false as const,
            },
          },
        },
        task: options.task
          ? {
              ...options.task,
              // Exercise storage recovery when compressed live context omits the wake.
              publish: (output, context) =>
                options.task!.publish(
                  output,
                  alphaCalls === 7
                    ? { ...context, messages: context.messages?.slice(-1) }
                    : context,
                ),
              tools: async (context) => ({
                ...(typeof options.task!.tools === 'function'
                  ? await options.task!.tools(context)
                  : options.task!.tools),
                quiet_gate: createTool({
                  id: 'quiet_gate',
                  description: 'Hold a quiet scheduled check',
                  inputSchema: { type: 'object', properties: {} },
                  execute: async () => {
                    checkEntered = true;
                    await quietGate.promise;
                    return { unchanged: true };
                  },
                }),
                gate: createTool({
                  id: 'gate',
                  description: 'Test gate',
                  inputSchema: { type: 'object', properties: {} },
                  execute: async () => {
                    gateEntered = true;
                    await gate.promise;
                    if (alphaCalls >= 4 && holdScheduledGate)
                      await scheduleGate.promise;
                    return { done: true };
                  },
                }),
              }),
            }
          : undefined,
      }).then((session) => {
        vi.spyOn(session.agent, 'stream');
        vi.spyOn(session.session, 'sendSignal');
        created.push(session);
        return session;
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
            PAL_AGENT_WORKING_DIR: '/unused',
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
    const chat = fixture.app.get(ChatService);
    const tasks = fixture.app.get(TasksService);
    const runtime = fixture.app.get<MastraAgentRuntime>(AGENT_RUNTIME);
    await request(fixture.url)
      .patch('/instance-settings')
      .send({ agentName: 'Waddledee' })
      .expect(200);
    await request(fixture.url)
      .post('/chat/messages')
      .send({
        idempotencyKey: randomUUID(),
        text: 'Delegate Alpha',
        destinationId: 'ios',
        metadata: { timezone: 'Asia/Singapore' },
        attachmentIds: [],
      })
      .expect(201);
    await until(() => gateEntered, 10000);
    expect(
      fixture.app.get(AgentActivityService).current().runningTasks,
    ).toContainEqual(
      expect.objectContaining({
        commentary: expect.objectContaining({ text: 'Alpha commentary' }),
      }),
    );
    // The Controller's call options override Agent defaults. Check the actual Main
    // invocation plus the resume boundary, while the task journey exercises >5 steps.
    const mainSession = created[0];
    const resultAttributes = (value: string) => {
      const calls = vi.mocked(created.at(-1)!.session).sendSignal.mock.calls;
      const signal = calls
        .map(([signal]) => signal)
        .findLast(
          (signal) =>
            signal.tagName === 'task-result' &&
            String(signal.contents).includes(value),
        );
      expect(signal).toBeDefined();
      return signal!.attributes!;
    };
    const mainOptions = vi.mocked(mainSession.agent).stream.mock.calls[0][1];
    const taskOptions = await mainSession.taskAgent!.getDefaultOptions();
    for (const options of [
      mainOptions,
      mainSession.session.machinery.buildSharedRunOptions(),
      taskOptions,
    ]) {
      expect(options?.maxSteps).toBe(0);
      const stopWhen = options?.stopWhen;
      expect(typeof stopWhen).toBe('function');
      expect((stopWhen as () => boolean)()).toBe(false);
      if (options === taskOptions)
        expect(options?.structuredOutput?.schema).toBeDefined();
      else expect(options?.structuredOutput).toBeUndefined();
    }
    expect(taskOptions?.modelSettings?.timeout).toEqual({
      firstChunkMs: 120_000,
      stepMs: 300_000,
    });
    expect(taskOptions?.modelSettings?.maxRetries).toBe(1);

    await until(
      async () =>
        (await chat.history({})).messages.some(
          (m) => m.text === 'Main acknowledgement',
        ),
      10000,
    );
    expect((await chat.getBySequence(1))?.reaction).toBe('👀');
    const alpha = (await tasks.search({ queries: ['Alpha'] })).tasks[0]!;
    mainInputRef = (await chat.history({})).messages.find(
      (message) => message.role === 'user',
    )!.sequence;
    await expect(
      runtime.delegate({
        taskId: alpha.id,
        message: 'Invalid source',
        sourceMessageRefs: [999999999],
      }),
    ).rejects.toThrow('Source message is not in Main chat');
    expect((await tasks.search({ queries: ['%'] })).tasks).toEqual([]);
    expect(fixture.app.get(AgentActivityService).current().status).toBe(
      'working',
    );
    const steering = {
      idempotencyKey: randomUUID(),
      text: 'Correction: ALPHA-43 replaces ALPHA-42',
      destinationId: 'web',
      metadata: { timezone: 'Europe/London' },
      taskId: alpha.id,
      replyToMessageId: (
        await chat.history({ taskId: alpha.id })
      ).messages.find((message) => message.text === 'Alpha commentary')!.id,
      attachmentIds: [],
    };
    const first = await request(fixture.url)
      .post('/chat/messages')
      .send(steering)
      .expect(201);
    const repeated = await request(fixture.url)
      .post('/chat/messages')
      .send(steering)
      .expect(201);
    expect(repeated.body).toEqual(first.body);
    expect(alphaCalls).toBe(1);
    // A selected source supplies provenance without selecting delivery destinations.
    const oldReference = await chat.publish({
      role: 'user',
      source: 'web',
      originDestinationId: 'web',
      text: 'Earlier context, not submitted to the runtime',
    });
    await runtime.delegate({
      title: 'Beta tickets',
      goal: 'Remember BETA-7',
      message: 'Remember BETA-7',
      sourceMessageRefs: [oldReference.sequence, mainInputRef],
    });
    await until(
      async () =>
        (await chat.history({})).messages.some((m) => m.text === 'Beta final'),
      10000,
    );
    expect(
      (await chat.history({})).messages.find((m) => m.text === 'Beta final')
        ?.notificationDestinationIds,
    ).toEqual(['ios', 'web']);
    expect(
      taskPrompts.some(
        (prompt) =>
          prompt.includes('Beta tickets') &&
          prompt.includes('Source user message #' + oldReference.sequence),
      ),
    ).toBe(true);
    expect(fixture.app.get(AgentActivityService).current().status).toBe(
      'working',
    );
    gate.resolve();
    await until(
      async () => (await schedules.list(alpha.id)).length === 1,
      10000,
    );
    await until(() => alphaCalls >= 4, 10000);
    const [scheduled] = await schedules.list(alpha.id);
    const nativeStore = (await mainSession.storage.getStore('schedules'))!;
    await nativeStore.updateSchedule(scheduled.id, {
      nextFireAt: Date.now() - 1000,
    });
    await mainSession.mastra.scheduler!.tick();
    await until(
      async () =>
        (await mainSession.mastra.schedules.get(scheduled.id))?.lastFireAt !==
        undefined,
      10000,
    );
    await schedules.pause(alpha.id, scheduled.id);
    expect(
      mainSession
        .taskAgent!.listActiveThreadRuns()
        .some((run) => run.threadId === 'pal-task:' + alpha.id),
    ).toBe(true);
    await schedules.resume(alpha.id, scheduled.id);
    const activeMemory = (await mainSession.storage.getStore('memory'))!;
    await activeMemory.saveMessages({
      messages: Array.from({ length: 110 }, () =>
        createSignal({
          type: 'reactive',
          id: randomUUID(),
          contents: 'Work retained in this execution',
        }).toDBMessage({
          threadId: 'pal-task:' + alpha.id,
          resourceId: sessions.MAIN_RESOURCE_ID,
        }),
      ),
    });
    const activeReads = vi.spyOn(activeMemory, 'listMessages');
    holdScheduledGate = false;
    scheduleGate.resolve();
    await until(async () => {
      const messages = (await chat.history({})).messages;
      return ['Alpha final ALPHA-43', 'Alpha next steps'].every((text) =>
        messages.some((message) => message.text === text),
      );
    }, 10000);
    await until(
      () => fixture!.app.get(AgentActivityService).current().status === 'idle',
      10000,
    );
    const mainHistory = (await chat.history({})).messages;
    const alphaHistory = (await chat.history({ taskId: alpha.id })).messages;
    expect(
      alphaHistory.some(
        (m) => m.text === 'Alpha commentary' && m.phase === 'commentary',
      ),
    ).toBe(true);
    expect(mainHistory.some((m) => m.text === 'Alpha commentary')).toBe(false);
    const final = alphaHistory.find((m) => m.text === 'Alpha final ALPHA-43');
    expect(final).toMatchObject({
      deliveryDestinationIds: [],
      notificationDestinationIds: [],
      notify: false,
      source: null,
    });
    expect(
      alphaHistory.find((m) => m.text === 'Alpha commentary'),
    ).toMatchObject({
      deliveryDestinationIds: [],
      notificationDestinationIds: [],
      notify: false,
    });
    const alphaResult = resultAttributes('Alpha final ALPHA-43');
    expect(
      activeReads.mock.calls.some(
        ([input]) => input.page === 1 && input.includeTotal === false,
      ),
    ).toBe(true);
    activeReads.mockRestore();
    expect(JSON.parse(String(alphaResult.origins))).toHaveLength(2);
    expect(JSON.parse(String(alphaResult.origins))).toEqual(
      expect.arrayContaining([
        { messageRef: mainInputRef, destinationId: 'ios' },
        {
          messageRef: (await chat.get(first.body.messageId)).sequence,
          destinationId: 'web',
        },
      ]),
    );
    expect(JSON.parse(String(alphaResult.scheduleIds))).toEqual([scheduled.id]);
    expect(final?.phase).toBe('final_answer');
    const next = mainHistory.find((m) => m.text === 'Alpha next steps');
    expect(next).toMatchObject({
      phase: null,
      taskId: null,
      replyToMessageId: null,
      deliveryDestinationIds: ['ios', 'web'],
    });
    expect(
      alphaHistory.find((m) => m.text === 'Alpha next steps')?.id,
    ).not.toBe(next?.id);
    expect(final?.replyTo?.sequence).toBe(mainInputRef);
    expect(mainHistory.find((m) => m.text === 'Starting Alpha')?.phase).toBe(
      null,
    );
    expect(
      mainHistory.find((m) => m.text === 'Main acknowledgement')?.phase,
    ).toBeNull();
    expect(alphaCalls).toBeGreaterThanOrEqual(7);
    const beta = (await tasks.search({ queries: ['Beta'] })).tasks[0]!;
    const taskCalls = model.doStreamCalls.filter((call) =>
      JSON.stringify(call.prompt).includes('You are the task agent'),
    );
    expect(
      taskCalls.some(
        (call) => call.headers?.['session-id'] === `pal-task:${alpha.id}`,
      ),
    ).toBe(true);
    expect(
      taskCalls.some(
        (call) => call.headers?.['session-id'] === `pal-task:${beta.id}`,
      ),
    ).toBe(true);
    expect(
      taskCalls.every(
        (call) =>
          call.headers?.['session-id'] === `pal-task:${alpha.id}` ||
          call.headers?.['session-id'] === `pal-task:${beta.id}`,
      ),
    ).toBe(true);
    expect(mainPrompts[0]).toContain('Asia/Singapore');
    expect(mainPrompts[0]).toContain('Your name is Waddledee.');
    expect(
      taskPrompts.every((prompt) => prompt.includes('Your name is Waddledee.')),
    ).toBe(true);
    expect(taskPrompts.some((p) => p.includes('Europe/London'))).toBe(true);
    expect(
      taskPrompts.some((p) => p.includes('Quoted earlier assistant message')),
    ).toBe(true);
    expect(taskPrompts.some((p) => p.includes('Source user message'))).toBe(
      true,
    );
    expect(
      taskPrompts.some(
        (p) =>
          p.includes('scheduled-execution') &&
          p.includes('automation') &&
          p.includes(scheduled.id),
      ),
    ).toBe(true);
    expect(mainHistory.find((m) => m.id === final?.id)).toBeUndefined();
    expect(mainHistory.find((m) => m.text === final?.text)?.taskId).toBeNull();
    expect(mainCalls).toBeGreaterThan(2);
    expect(
      mainPrompts.some(
        (p) =>
          p.includes('Task outcome #') &&
          p.includes('origins') &&
          p.includes('ios') &&
          p.includes('web') &&
          p.includes('destinationId'),
      ),
    ).toBe(true);
    expect(await tasks.details(alpha.id)).toMatchObject({
      title: 'Alpha tickets',
      goal: 'Find ALPHA-43',
      description: 'Look for ALPHA-43 tickets.',
      status: 'needs-input',
    });
    const updatedDetails = await request(fixture.url)
      .get('/tasks/details/' + alpha.id)
      .expect(200);
    expect(updatedDetails.body.task.goal).toBe('Find ALPHA-43');
    expect(
      taskPrompts
        .filter((p) => p.includes('Beta tickets'))
        .every((p) => !p.includes('ALPHA-42')),
    ).toBe(true);
    expect(taskPrompts[taskPrompts.length - 1]).toContain(
      'Correction: ALPHA-43',
    );
    await expect(
      schedules.update(
        (await tasks.search({ queries: ['Beta'] })).tasks[0].id,
        scheduled.id,
        {
          prompt: 'Wrong task',
        },
      ),
    ).rejects.toThrow('Task schedule not found');
    expect((await schedules.pause(alpha.id, scheduled.id)).status).toBe(
      'paused',
    );
    expect((await schedules.resume(alpha.id, scheduled.id)).status).toBe(
      'active',
    );
    await expect(
      schedules.update(alpha.id, scheduled.id, { cron: 'bad' }),
    ).rejects.toThrow();
    expect((await tasks.details(alpha.id)).id).toBe(alpha.id);
    await tasks.update(alpha.id, { status: 'in-progress' });
    await mainSession.mastra.stopWorkers();
    await nativeStore.updateSchedule(scheduled.id, {
      nextFireAt: Date.now() - 86400000,
    });
    const savedSchedule = await mainSession.mastra.schedules.get(scheduled.id);
    if (savedSchedule?.agentId) {
      await mainSession.mastra.schedules.update(scheduled.id, {
        ifIdle: { ...savedSchedule.ifIdle, attributes: {} },
      });
    }
    // A long-lived Task retains older conversation without pulling its origins into new outcomes.
    const memory = (await mainSession.storage.getStore('memory'))!;
    await memory.saveMessages({
      messages: Array.from({ length: 150 }, (_, index) =>
        createSignal({
          type: 'user',
          id: randomUUID(),
          createdAt: new Date(Date.now() - 86400000 - index),
          contents: 'Older unrelated execution',
          attributes: { messageRef: oldReference.sequence },
        }).toDBMessage({
          threadId: 'pal-task:' + alpha.id,
          resourceId: sessions.MAIN_RESOURCE_ID,
        }),
      ),
    });
    await runtime.beforeApplicationShutdown();
    quietCheck = true;
    // Recreate against the same storage without waking tasks.
    const calls = model.doStreamCalls.length;
    const replacement = new MastraAgentRuntime(
      new ConfigService({
        DATABASE_URL: process.env.DATABASE_URL,
        PAL_AGENT_MODEL: 'fixture',
        PAL_AGENT_AUTH_PATH: '/unused',
        PAL_AGENT_THINKING_EFFORT: 'medium',
        PAL_AGENT_WORKING_DIR: '/unused',
      }),
      chat,
      fixture.app.get(AgentActivityService),
      tasks,
      schedules,
      fixture.app.get(McpService),
      fixture.app.get(AgentAdmissionService),
      fixture.app.get(BrowserService),
      fixture.app.get(LoginService),
      fixture.app.get(FilesService),
      fixture.app.get(PreferencesService),
      fixture.app.get(DestinationService),
      fixture.app.get(InstanceSettingsService),
      fixture.app.get(ExecutionService),
    );
    try {
      await replacement.onModuleInit();
      await until(() => checkEntered, 10000);
      expect(fixture.app.get(AgentActivityService).current().status).toBe(
        'working',
      );
      quietGate.resolve();
      await until(
        () =>
          fixture!.app.get(AgentActivityService).current().status === 'idle',
        10000,
      );
      expect(model.doStreamCalls.length).toBe(calls + 2);
      expect(taskPrompts.at(-1)).toContain('Correction: ALPHA-43');
      const systemPrompt = (
        JSON.parse(taskPrompts.at(-1)!) as { role: string; content: string }[]
      )
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n');
      expect(systemPrompt).toContain('Find ALPHA-43');
      expect(systemPrompt).toContain('Look for ALPHA-43 tickets.');
      expect(taskPrompts.at(-1)).toContain(scheduled.id);
      expect((await chat.history({ taskId: alpha.id })).messages).toEqual(
        alphaHistory,
      );
      expect((await schedules.list(alpha.id))[0].timezone).toBe(
        'Asia/Singapore',
      );
      const restored = await created.at(-1)!.mastra.schedules.get(scheduled.id);
      expect(restored!.nextFireAt).toBeGreaterThan(Date.now());
      expect((await tasks.details(alpha.id)).status).toBe('in-progress');
      failCheck = true;
      await created.at(-1)!.mastra.schedules.run(scheduled.id);
      await until(
        async () =>
          (await chat.history({ taskId: alpha.id })).messages.some(
            (message) =>
              message.text === 'I could not complete that scheduled check.',
          ),
        10000,
      );
      await until(
        () =>
          fixture!.app.get(AgentActivityService).current().status === 'idle',
        10000,
      );
      expect(
        (await chat.history({})).messages.find((message) =>
          message.text.includes('scheduled check'),
        ),
      ).toMatchObject({
        notificationDestinationIds: ['ios', 'web'],
        notify: true,
        phase: null,
      });
      const scheduledFailure = resultAttributes(
        'I could not complete that scheduled check.',
      );
      expect(JSON.parse(String(scheduledFailure.origins))).toEqual([]);
      expect(JSON.parse(String(scheduledFailure.scheduleIds))).toEqual([
        scheduled.id,
      ]);
      expect(
        restored?.agentId && restored.ifIdle?.attributes?.executionStart,
      ).toBe(true);
      failCheck = false;
      quietCheck = false;
      await replacement.submit(
        await chat.publish({
          role: 'user',
          text: 'What did Alpha find?',
          replyToMessageId: (await chat.history({})).messages.find(
            (m) => m.text === final!.text,
          )!.id,
        }),
      );
      await until(
        () =>
          fixture!.app.get(AgentActivityService).current().status === 'idle',
        10000,
      );
      expect(mainPrompts.at(-1)).toContain('Alpha final ALPHA-43');
      expect(mainPrompts.at(-1)).toContain('Quoted earlier assistant message');
      await replacement.submit(
        await chat.publish({ role: 'user', text: 'Keep Main active' }),
      );
      await until(() => mainGateEntered, 10000);
      const continuation = await chat.publish({
        role: 'user',
        source: 'web',
        originDestinationId: 'web',
        text: 'Continue Alpha',
      });
      const restoredMemory = (await created
        .at(-1)!
        .storage.getStore('memory'))!;
      const reads = vi.spyOn(restoredMemory, 'listMessages');
      await replacement.delegate({
        taskId: alpha.id,
        message: 'Continue Alpha',
        sourceMessageRefs: [continuation.sequence],
      });
      await until(
        async () =>
          (await chat.history({ taskId: alpha.id })).messages.some(
            (m) => m.text === 'Alpha continued ALPHA-43',
          ),
        10000,
      );
      mainGate.resolve();
      await until(
        () =>
          fixture!.app.get(AgentActivityService).current().status === 'idle',
        10000,
      );
      expect(taskPrompts.at(-1)).toContain('Correction: ALPHA-43');
      expect(taskPrompts.at(-1)).toContain('Alpha final ALPHA-43');
      expect(taskPrompts.at(-1)).not.toContain('BETA-7');
      expect(mainPrompts.at(-1)).toContain('Alpha continued ALPHA-43');
      const continuedResult = resultAttributes('Alpha continued ALPHA-43');
      expect(JSON.parse(String(continuedResult.origins))).toEqual([
        { messageRef: continuation.sequence, destinationId: 'web' },
      ]);
      expect(continuedResult.scheduleIds).toBeUndefined();
      expect(reads.mock.calls.every(([input]) => (input.page ?? 0) === 0)).toBe(
        true,
      );
      reads.mockRestore();
      // Explicitly selected older sources remain valid in a fresh execution.
      const previousResults = vi.mocked(created.at(-1)!.session).sendSignal.mock
        .calls.length;
      await replacement.delegate({
        taskId: alpha.id,
        message: 'Continue with the earlier request',
        sourceMessageRefs: [continuation.sequence, mainInputRef],
      });
      await until(
        () =>
          vi.mocked(created.at(-1)!.session).sendSignal.mock.calls.length >
          previousResults,
        10000,
      );
      await until(
        () =>
          fixture!.app.get(AgentActivityService).current().status === 'idle',
        10000,
      );
      expect(
        JSON.parse(
          String(resultAttributes('Alpha continued ALPHA-43').origins),
        ),
      ).toEqual(
        expect.arrayContaining([
          { messageRef: continuation.sequence, destinationId: 'web' },
          { messageRef: mainInputRef, destinationId: 'ios' },
        ]),
      );
    } finally {
      mainGate.resolve();
      await schedules.delete(alpha.id, scheduled.id);
      expect(await schedules.list(alpha.id)).toEqual([]);
      await replacement.beforeApplicationShutdown();
    }
  } finally {
    gate.resolve();
    scheduleGate.resolve();
    quietGate.resolve();
    mainGate.resolve();
    await fixture?.close();
    sessionSpy.mockRestore();
    providerSpy.mockRestore();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await pool.end();
    }
  }
});
