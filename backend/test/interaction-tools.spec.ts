import { RequestContext } from '@mastra/core/request-context';
import { noopObserve, createTool, type Tool } from '@mastra/core/tools';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import type { ProcessInputStepArgs } from '@mastra/core/processors';
import { InteractionToolsProcessor } from '../dist/agent/interaction-tools.processor.js';
import { InteractionCoordinator } from '../dist/interaction/interaction-coordinator.js';
import { X11Computer } from '../dist/agent/x11-computer.js';
import {
  INTERACTION_EXECUTION_ID,
  PARENT_TASK_ID,
  WORKER_ID,
} from '../dist/agent/task-workers.js';

it('coordinates native device/private tools without changing media and rejects device switching and late calls', async () => {
  const coordinator = new InteractionCoordinator();
  const activate = vi.fn();
  const processor = new InteractionToolsProcessor(coordinator, activate);
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
  expect(activate).toHaveBeenCalledWith('task', 'worker', 'browser');
  expect(await call('inspect_private_fields')).toBe(media);
  await expect(call('android_inspect')).rejects.toThrow('fresh worker');
  await coordinator.finish(executionId);
  await expect(call(screenshot)).rejects.toThrow('ended');
});

it('guards desktop commands in execution and fences both native and client timeout uncertainty', async () => {
  const result = {
    success: true,
    stdout: '',
    stderr: '',
    exitCode: 0,
    executionTimeMs: 0,
  };
  const run = vi.fn(async () => result);
  const uncertain = vi.fn();
  const computer = new X11Computer({ run }, undefined, uncertain);
  await computer.press('Return');
  expect(run).toHaveBeenCalledWith(
    'flock',
    [
      '--exclusive',
      '--wait',
      '35',
      '/home/pal/tmp/pal-desktop-input.lock',
      'timeout',
      '--kill-after=2s',
      '30s',
      'xdotool',
      'key',
      '--clearmodifiers',
      'Return',
    ],
    { input: undefined, timeout: 70_000 },
  );
  await computer.press(['CTRL', 'T']);
  expect(run).toHaveBeenCalledWith(
    'flock',
    expect.arrayContaining(['Control_L+t']),
    expect.anything(),
  );
  await computer.press(['CTRL', 'SHIFT', 'T']);
  expect(run).toHaveBeenCalledWith(
    'flock',
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
  expect(uncertain).toHaveBeenCalledTimes(3);
});
