import type { ToolsInput } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { jsonSchema } from 'ai';
import { PARENT_TASK_ID, WORKER_ID } from '../agent/task-workers.js';
import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { taskIdFromThread } from '../agent/task-tools.js';
import type { BrowserService } from './browser.service.js';

export function browserTools(browser: BrowserService): ToolsInput {
  if (!browser.enabled) return {};
  const identity = (
    context: { requestContext?: { get(key: string): unknown } } | undefined,
  ) => {
    const workerId = context?.requestContext?.get(WORKER_ID);
    const parentId = context?.requestContext?.get(PARENT_TASK_ID);
    if (typeof workerId === 'string' && typeof parentId === 'string')
      return { taskId: parentId, workerId };
    return {
      taskId: taskIdFromThread(
        context?.requestContext?.get(MASTRA_THREAD_ID_KEY),
      ),
      workerId: undefined,
    };
  };
  return {
    browser: createTool({
      id: 'browser',
      description:
        'Run agent-browser arguments in this task’s pinned session and shared Chromium profile. Examples: ["open","https://example.com"], ["snapshot","-i"], ["click","@e1"], ["fill","@e2","text"], ["tab","new","https://example.com"], ["tab","list"], ["tab","<targetId>"], ["tab","close"], ["eval","expression"]. Use ["<command>","--help"] for upstream documentation. Supply arguments as data; Pal supplies session/CDP options. Use individual calls rather than batch. ["close"] closes the task group, or only your session when you are a worker. Use browser_screenshot for images.',
      inputSchema: jsonSchema<{ args: string[] }>({
        type: 'object',
        properties: {
          args: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
        required: ['args'],
        additionalProperties: false,
      }),
      execute: ({ args }, context) => {
        const { taskId, workerId } = identity(context);
        return browser.command(taskId, args, context?.abortSignal, workerId);
      },
    }),
    browser_group: createTool({
      id: 'browser_group',
      description:
        'List your current browser tabs (targetId selects a tab), or close your workspace. A task closes its group; a worker closes only its session’s member tabs and daemon. Tabs moved out of the group are preserved.',
      inputSchema: jsonSchema<{ action: 'list' | 'close' }>({
        type: 'object',
        properties: { action: { type: 'string', enum: ['list', 'close'] } },
        required: ['action'],
        additionalProperties: false,
      }),
      execute: async ({ action }, context) => {
        const { taskId, workerId } = identity(context);
        if (action === 'close') {
          if (workerId) await browser.closeSession(taskId, workerId);
          else await browser.closeGroup(taskId);
          return { closed: true };
        }
        return {
          groups: (await browser.groups())
            .filter((group) => group.taskId === taskId)
            .map((group) =>
              workerId
                ? {
                    ...group,
                    tabs: group.tabs?.filter(
                      (tab) => tab.sessionId === 'worker-' + workerId,
                    ),
                  }
                : group,
            ),
        };
      },
    }),
    browser_screenshot: createTool({
      id: 'browser_screenshot',
      description:
        'Return a PNG screenshot of this task’s selected browser tab as image content.',
      inputSchema: jsonSchema<{ fullPage: boolean }>({
        type: 'object',
        properties: { fullPage: { type: 'boolean' } },
        required: ['fullPage'],
        additionalProperties: false,
      }),
      execute: ({ fullPage }, context) => {
        const { taskId, workerId } = identity(context);
        return browser.screenshot(
          taskId,
          fullPage,
          context?.abortSignal,
          workerId,
        );
      },
      outputSchema: jsonSchema<{
        text: string;
        data: string;
        mediaType: string;
      }>({
        type: 'object',
        properties: {
          text: { type: 'string' },
          data: { type: 'string' },
          mediaType: { type: 'string' },
        },
        required: ['text', 'data', 'mediaType'],
        additionalProperties: false,
      }),
      toModelOutput: (output) => ({
        type: 'content',
        value: [
          { type: 'text', text: output.text },
          { type: 'media', data: output.data, mediaType: output.mediaType },
        ],
      }),
    }),
  };
}
