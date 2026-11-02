import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { RequestContext } from '@mastra/core/request-context';
import { noopObserve, createTool, type Tool } from '@mastra/core/tools';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import type { ProcessInputStepArgs } from '@mastra/core/processors';
import { jsonSchema, asSchema } from 'ai';
import { ComputerSessionProcessor } from '../dist/agent/computer-session.processor.js';
import { PARENT_TASK_ID, WORKER_ID } from '../dist/agent/task-workers.js';
import { BrowserService } from '../dist/browser/browser.service.js';
import { EventsService } from '../dist/events/events.service.js';
import type { TasksService } from '../dist/tasks/tasks.service.js';
import type { ExecutionService } from '../dist/execution/execution.service.js';
import { loginTools } from '../dist/login/login-tools.js';
import type { LoginService } from '../dist/login/login.service.js';

it('prepares native computer calls using trusted worker identity and preserves media results', async () => {
  const prepareComputer = vi.fn(async () => {});
  const activateSurface = vi.fn();
  const processor = new ComputerSessionProcessor(
    {
      prepareComputer,
    } as unknown as BrowserService,
    activateSurface,
  );
  const result = { data: 'image', mediaType: 'image/png' };
  const execute = vi.fn(async () => result);
  const name = Object.values(WORKSPACE_TOOLS.COMPUTER)[0];
  const tool = createTool({
    id: name,
    description: 'Fixture',
    inputSchema: jsonSchema({ type: 'object' }),
    execute,
  });
  const { tools } = processor.processInputStep({
    tools: { [name]: tool },
  } as unknown as ProcessInputStepArgs);
  const context = {
    requestContext: new RequestContext([
      [PARENT_TASK_ID, 'task'],
      [WORKER_ID, 'worker'],
    ]),
    observe: noopObserve,
  };
  expect(await (tools[name] as Tool).execute!({}, context)).toBe(result);
  expect(prepareComputer).toHaveBeenCalledWith('task', 'worker');
  expect(activateSurface).toHaveBeenCalledWith('task', 'worker');
  await expect(
    (tools[name] as Tool).execute!(
      {},
      { requestContext: new RequestContext(), observe: noopObserve },
    ),
  ).rejects.toThrow('interaction worker');
  expect(execute).toHaveBeenCalledTimes(1);
});

it('serializes desktop setup and rejects competing owners until release', async () => {
  const service = new BrowserService(
    new ConfigService({ PAL_DESKTOP_ENABLED: true }),
    { details: async () => ({ title: 'Fixture' }) } as unknown as TasksService,
    new EventsService(),
    {} as ExecutionService,
  );
  const internal = service as unknown as {
    connect(): Promise<void>;
    groupRequest(input: { action: string }): Promise<{ ready: boolean }>;
  };
  let ready!: () => void;
  vi.spyOn(internal, 'connect').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
  );
  const group = vi
    .spyOn(internal, 'groupRequest')
    .mockResolvedValue({ ready: true });
  const a = service.prepareComputer('a', 'one');
  const b = service.prepareComputer('a', 'one');
  await expect(service.prepareComputer('b', 'two')).rejects.toThrow('busy');
  expect(group).not.toHaveBeenCalled();
  ready();
  await Promise.all([a, b]);
  expect(
    group.mock.calls.filter(([arg]) => arg.action === 'computer_prepare'),
  ).toHaveLength(1);
  service.releaseComputer('b', 'two');
  await expect(service.prepareComputer('b', 'two')).rejects.toThrow('busy');
  service.releaseComputer('a', 'one');
  vi.spyOn(internal, 'connect').mockResolvedValue();
  await service.prepareComputer('b', 'two');
});

it('exposes active-surface private tools without target, account or action selectors', async () => {
  const tools = loginTools({ androidEnabled: true } as LoginService);
  for (const name of [
    'inspect_private_fields',
    'enter_private_fields',
  ] as const) {
    const schema = await asSchema(tools[name].inputSchema).jsonSchema;
    expect(schema.properties).not.toHaveProperty('action');
    expect(schema.properties).not.toHaveProperty('target');
    expect(schema.properties).not.toHaveProperty('accountId');
    expect(schema.additionalProperties).toBe(false);
  }
  const schema = await asSchema(tools.confirm_authentication.inputSchema)
    .jsonSchema;
  expect(schema.properties).not.toHaveProperty('action');
});
