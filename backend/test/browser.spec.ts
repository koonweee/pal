import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
} from '@mastra/core/request-context';
import { noopObserve, type Tool } from '@mastra/core/tools';
import { PARENT_TASK_ID, WORKER_ID } from '../dist/agent/task-workers.js';
import type { ExecutionService } from '../dist/execution/execution.service.js';
import { BrowserService } from '../dist/browser/browser.service.js';
import { browserTools } from '../dist/browser/browser-tools.js';
import { EventsService } from '../dist/events/events.service.js';
import { TasksService } from '../dist/tasks/tasks.service.js';

it('routes concurrent task tools by trusted thread identity and preserves screenshot media', async () => {
  const service = new BrowserService(
    new ConfigService({ PAL_DESKTOP_ENABLED: true }),
    {} as TasksService,
    new EventsService(),
    {} as ExecutionService,
  );
  const command = vi
    .spyOn(service, 'command')
    .mockResolvedValue({ success: true, data: {}, error: null });
  const image = { text: 'fixture', data: 'aW1hZ2U=', mediaType: 'image/png' };
  vi.spyOn(service, 'screenshot').mockResolvedValue(image);
  const tools = browserTools(service);
  const context = (id: string) => ({
    requestContext: new RequestContext([
      [MASTRA_THREAD_ID_KEY, 'pal-task:' + id],
    ]),
    observe: noopObserve,
  });
  await Promise.all([
    (tools.browser as Tool).execute!({ args: ['snapshot'] }, context('a')),
    (tools.browser as Tool).execute!({ args: ['snapshot'] }, context('b')),
  ]);
  expect(command.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b']);
  const workerContext = {
    requestContext: new RequestContext([
      [MASTRA_THREAD_ID_KEY, 'native-child-thread'],
      [PARENT_TASK_ID, 'a'],
      [WORKER_ID, 'worker-one'],
    ]),
    observe: noopObserve,
  };
  await (tools.browser as Tool).execute!({ args: ['snapshot'] }, workerContext);
  expect(command).toHaveBeenLastCalledWith(
    'a',
    ['snapshot'],
    undefined,
    'worker-one',
  );
  const close = vi.spyOn(service, 'closeSession').mockResolvedValue();
  await (tools.browser_group as Tool).execute!(
    { action: 'close' },
    workerContext,
  );
  expect(close).toHaveBeenCalledWith('a', 'worker-one');
  const screenshot = tools.browser_screenshot as Tool;
  const result = await screenshot.execute!({ fullPage: false }, context('a'));
  expect(screenshot.toModelOutput!(result)).toMatchObject({
    type: 'content',
    value: [{ type: 'text' }, { type: 'media', mediaType: 'image/png' }],
  });
  await expect(
    (tools.browser as Tool).execute!(
      { args: ['snapshot'] },
      { requestContext: new RequestContext(), observe: noopObserve },
    ),
  ).rejects.toThrow('Task thread');
  expect(
    browserTools(
      new BrowserService(
        new ConfigService(),
        {} as TasksService,
        new EventsService(),
        {} as ExecutionService,
      ),
    ),
  ).toEqual({});
});
