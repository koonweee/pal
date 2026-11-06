import { RequestContext } from '@mastra/core/request-context';
import { noopObserve, createTool, type Tool } from '@mastra/core/tools';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import type { ProcessInputStepArgs } from '@mastra/core/processors';
import { InteractionToolsProcessor } from '../dist/agent/interaction-tools.processor.js';
import { interactionHistoryProcessor } from '../dist/agent/interaction-history.processor.js';
import { InteractionCoordinator } from '../dist/interaction/interaction-coordinator.js';
import { X11Computer } from '../dist/agent/x11-computer.js';
import {
  INTERACTION_EXECUTION_ID,
  PARENT_TASK_ID,
  WORKER_ID,
} from '../dist/agent/task-workers.js';

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
  const processor = new InteractionToolsProcessor(coordinator);
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
