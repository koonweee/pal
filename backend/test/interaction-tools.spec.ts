import { RequestContext } from '@mastra/core/request-context';
import { noopObserve, createTool, type Tool } from '@mastra/core/tools';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import type { ProcessInputStepArgs } from '@mastra/core/processors';
import { InteractionToolsProcessor } from '../dist/agent/interaction-tools.processor.js';
import { InteractionVisualArtifactsProcessor } from '../dist/agent/interaction-visual-artifacts.processor.js';
import { interactionHistoryProcessor } from '../dist/agent/interaction-history.processor.js';
import { InteractionCoordinator } from '../dist/interaction/interaction-coordinator.js';
import { X11Computer } from '../dist/agent/x11-computer.js';
import {
  INTERACTION_EXECUTION_ID,
  PARENT_TASK_ID,
  WORKER_ID,
} from '../dist/agent/task-workers.js';

it('externalizes completed screenshots and transiently hydrates only the newest image', async () => {
  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  ];
  const stored = new Map<string, Buffer>();
  const files = {
    upload: vi.fn(async ({ stream }: { stream: AsyncIterable<Buffer> }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const id = ids[stored.size];
      stored.set(id, Buffer.concat(chunks));
      return { id };
    }),
    content: vi.fn(async (id: string) => ({
      file: { contentType: 'image/png' },
      handle: {
        readFile: async () => stored.get(id)!,
        close: async () => {},
      },
    })),
  };
  const screenshot = WORKSPACE_TOOLS.COMPUTER.SCREENSHOT;
  const images = [Buffer.from('old image'), Buffer.from('new image')].map(
    (bytes) => bytes.toString('base64'),
  );
  const parts = images.map((data, index) => ({
    type: 'tool-invocation',
    toolInvocation: {
      state: 'result',
      toolCallId: `visual-${index}`,
      toolName: screenshot,
      args: {},
      result: {
        __workspaceMedia: true,
        text: `screenshot ${index}`,
        mediaType: 'image/png',
        data,
      },
    },
    providerMetadata: {
      mastra: {
        modelOutput: {
          type: 'content',
          value: [{ type: 'media', mediaType: 'image/png', data }],
        },
      },
    },
  }));
  const message = {
    role: 'assistant',
    content: { format: 2, parts },
  };
  const messageList = {
    get: { all: { db: () => [message] } },
    updateToolInvocation: (next: (typeof parts)[number]) => {
      const index = parts.findIndex(
        (part) =>
          part.toolInvocation.toolCallId === next.toolInvocation.toolCallId,
      );
      parts[index] = next;
      return true;
    },
  };
  const steps = [{ toolResults: structuredClone(parts) }];
  const processor = new InteractionVisualArtifactsProcessor(files as never);

  await processor.processInputStep({ messageList, steps } as never);

  expect(files.upload).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(message)).not.toContain(images[0]);
  expect(JSON.stringify(message)).not.toContain(images[1]);
  expect(JSON.stringify(steps)).not.toContain(images[0]);
  expect(JSON.stringify(steps)).not.toContain(images[1]);
  const prompt = parts.map((part) => ({
    role: 'tool' as const,
    content: [
      {
        type: 'tool-result' as const,
        toolCallId: part.toolInvocation.toolCallId,
        toolName: screenshot,
        output: part.providerMetadata.mastra.modelOutput,
      },
    ],
  }));
  const source = structuredClone(prompt);
  const hydrated = await processor.processLLMRequest({ prompt } as never);

  expect(prompt).toEqual(source);
  expect(JSON.stringify(hydrated?.prompt)).toContain(images[1]);
  expect(JSON.stringify(hydrated?.prompt)).not.toContain(images[0]);
  expect(files.content).toHaveBeenCalledTimes(1);
  expect(files.content).toHaveBeenCalledWith(ids[1]);
});

it('keeps recent visual steps while transiently filtering older images', async () => {
  const processor = interactionHistoryProcessor();
  const screenshot = WORKSPACE_TOOLS.COMPUTER.SCREENSHOT;
  const prompt: unknown[] = [
    { role: 'system', content: 'system' },
    { role: 'user', content: [{ type: 'text', text: 'Complete the flow' }] },
  ];
  const addToolStep = (
    toolCallId: string,
    toolName: string,
    output: string,
  ) => {
    prompt.push({
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId, toolName, input: {} }],
    });
    prompt.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName,
          output: { type: 'text', value: output },
        },
      ],
    });
  };
  addToolStep('old-computer', screenshot, 'old-computer-image');
  addToolStep('old-android', 'android_screenshot', 'old-android-image');
  addToolStep('old-nonvisual', 'skill_read', 'durable guidance');
  addToolStep('recent-computer', screenshot, 'recent-computer-image');
  addToolStep(
    'recent-private',
    'inspect_private_fields',
    'recent-private-image',
  );
  const source = structuredClone(prompt);

  const result = await processor.processLLMRequest({
    prompt,
    steps: [],
  } as never);
  const filtered = JSON.stringify(result?.prompt);

  expect(filtered).not.toContain('old-computer-image');
  expect(filtered).not.toContain('old-android-image');
  expect(filtered).toContain('recent-computer-image');
  expect(filtered).toContain('recent-private-image');
  expect(filtered).toContain('durable guidance');
  expect(prompt).toEqual(source);
});

it('coordinates native device/private tools without changing media and rejects device switching and late calls', async () => {
  const coordinator = new InteractionCoordinator();
  const beginWorker = vi.fn(async () => true);
  const processor = new InteractionToolsProcessor(coordinator, {
    beginWorker,
  } as never);
  const media = { data: 'image', mediaType: 'image/png' };
  const screenshot = Object.values(WORKSPACE_TOOLS.COMPUTER)[0];
  const tools = Object.fromEntries(
    [screenshot, 'android_inspect', 'inspect_private_fields'].map((name) => [
      name,
      createTool({
        id: name,
        description: name,
        inputSchema: { type: 'object', properties: {} },
        execute: async () => media,
      }),
    ]),
  );
  const wrapped = processor.processInputStep({
    tools,
  } as unknown as ProcessInputStepArgs).tools;
  const executionId = coordinator.begin(
    { taskId: 'task', workerId: 'worker' },
    'parent',
  );
  const context = {
    requestContext: new RequestContext([
      [PARENT_TASK_ID, 'task'],
      [WORKER_ID, 'worker'],
      [INTERACTION_EXECUTION_ID, executionId],
    ]),
    observe: noopObserve,
  };
  const call = (name: string) => (wrapped[name] as Tool).execute!({}, context);
  await expect(call('inspect_private_fields')).rejects.toThrow(
    'ordinary device',
  );
  expect(await call(screenshot)).toBe(media);
  expect(beginWorker).toHaveBeenCalledWith('task', 'worker');
  expect(coordinator.resourceFor(executionId)).toBe('desktop');
  expect(await call('inspect_private_fields')).toBe(media);
  await expect(call('android_inspect')).rejects.toThrow('fresh worker');
  coordinator.finish(executionId);
  await expect(call(screenshot)).rejects.toThrow('ended');
});

it('uses ordinary execution commands, normalizes chords and permits calls after failures', async () => {
  const result = {
    success: true,
    stdout: '',
    stderr: '',
    exitCode: 0,
    executionTimeMs: 0,
  };
  const run = vi.fn(async () => result);
  const computer = new X11Computer({ run });
  await computer.press('Return');
  expect(run).toHaveBeenCalledWith(
    'xdotool',
    ['key', '--clearmodifiers', 'Return'],
    { input: undefined },
  );
  await computer.press(['CTRL', 'T']);
  expect(run).toHaveBeenCalledWith(
    'xdotool',
    expect.arrayContaining(['Control_L+t']),
    expect.anything(),
  );
  await computer.press(['CTRL', 'SHIFT', 'T']);
  expect(run).toHaveBeenCalledWith(
    'xdotool',
    expect.arrayContaining(['Control_L+Shift_L+t']),
    expect.anything(),
  );
  for (const exitCode of [124, 137]) {
    run.mockResolvedValueOnce({ ...result, success: false, exitCode });
    await expect(computer.press('Return')).rejects.toThrow(
      'could not be confirmed',
    );
  }
  run.mockRejectedValueOnce(new Error('connection lost'));
  await expect(computer.press('Return')).rejects.toThrow('connection lost');
  run.mockRejectedValueOnce(new Error('screenshot connection lost'));
  await expect(computer.screenshot()).rejects.toThrow(
    'screenshot connection lost',
  );
  await computer.press('Return');
});
