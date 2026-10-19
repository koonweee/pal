import { createTool } from '@mastra/core/tools';
import { jsonSchema } from 'ai';
import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import type {
  TaskSchedulesService,
  ScheduleInput,
} from '../tasks/task-schedules.service.js';
import type { TasksService } from '../tasks/tasks.service.js';
import type { FilesService } from '../files/files.service.js';
import type { ChatService } from '../chat/chat.service.js';
import type { TaskStatus, TaskSearchInput } from '../tasks/tasks.types.js';

export const TASK_THREAD_PREFIX = 'pal-task:';
export function taskThreadId(taskId: string) {
  return TASK_THREAD_PREFIX + taskId;
}
export function taskIdFromThread(threadId: unknown): string {
  if (typeof threadId !== 'string' || !threadId.startsWith(TASK_THREAD_PREFIX))
    throw new Error('Task thread is required');
  return threadId.slice(TASK_THREAD_PREFIX.length);
}

export interface DelegationInput {
  taskId?: string;
  title?: string;
  goal?: string;
  message: string;
  sourceMessageRefs?: number[];
  attachmentIds?: string[];
}

export function mainTaskTools(
  tasks: TasksService,
  chat: ChatService,
  delegate: (input: DelegationInput) => Promise<{ taskId: string }>,
  files: FilesService,
) {
  return {
    search_tasks: createTool({
      id: 'search_tasks',
      description:
        'Search all tasks, including completed and archived. An empty result only rules out those terms: broaden to subject categories and synonyms before concluding no task fits. Each query matches all its literal terms across title, goal, and description; any query may match. Results are newest first, with compact title/goal and a matching description excerpt. Use inspect_task for full details. Continue with after using the same queries.',
      inputSchema: jsonSchema<TaskSearchInput>({
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          after: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
        required: ['queries'],
        additionalProperties: false,
      }),
      execute: (input) => tasks.search(input),
    }),
    inspect_task: createTool({
      id: 'inspect_task',
      description:
        'Inspect a candidate task and optionally a page of its public chat history. Use before to inspect older messages. Private model history is never returned.',
      inputSchema: jsonSchema<{
        taskId: string;
        includeHistory: boolean;
        before: number | null;
        limit: number;
      }>({
        type: 'object',
        properties: {
          taskId: { type: 'string', format: 'uuid' },
          includeHistory: { type: 'boolean' },
          before: { type: ['integer', 'null'], minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
        required: ['taskId', 'includeHistory', 'before', 'limit'],
        additionalProperties: false,
      }),
      execute: async ({ taskId, includeHistory, before, limit }) => {
        const [task, history] = await Promise.all([
          tasks.details(taskId),
          includeHistory
            ? chat.history({
                taskId,
                before: before ?? undefined,
                limit: Math.min(20, Math.max(1, limit ?? 10)),
              })
            : null,
        ]);
        if (history)
          history.messages = await Promise.all(
            history.messages.map(async (message) => ({
              ...message,
              attachments: await files.manifest(
                message.attachments.map((file) => file.id),
              ),
            })),
          );
        return { task, ...(history ? { history } : {}) };
      },
    }),
    delegate_task: createTool({
      id: 'delegate_task',
      description:
        'Start or steer an existing task by taskId, or create a task with title and goal. Include relevant context and preferences in message. Pass sourceMessageRefs for the user requests and steering this handoff addresses; their origins are forwarded automatically. attachmentIds can select other known files. Returns after input acceptance; work continues independently.',
      inputSchema: jsonSchema<DelegationInput>({
        type: 'object',
        properties: {
          taskId: { type: 'string', format: 'uuid' },
          title: { type: 'string', minLength: 1 },
          goal: { type: 'string', minLength: 1 },
          message: { type: 'string', minLength: 1 },
          sourceMessageRefs: {
            type: 'array',
            uniqueItems: true,
            maxItems: 100,
            items: { type: 'integer', minimum: 1 },
          },
          attachmentIds: {
            type: 'array',
            maxItems: 100,
            uniqueItems: true,
            items: { type: 'string', format: 'uuid' },
          },
        },
        required: ['message'],
        additionalProperties: false,
      }),
      execute: (input) => delegate(input),
    }),
  };
}

export function taskUpdateTool(tasks: TasksService) {
  return createTool({
    id: 'update_task',
    description:
      'Update this task title, goal, or description to reflect the latest user request. Supply changed fields; omit or use null for unchanged fields.',
    inputSchema: jsonSchema<{
      title?: string | null;
      goal?: string | null;
      description?: string | null;
    }>({
      type: 'object',
      properties: {
        title: { type: ['string', 'null'], minLength: 1 },
        goal: { type: ['string', 'null'], minLength: 1 },
        description: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    }),
    execute: async ({ title, goal, description }, context) => {
      const taskId = taskIdFromThread(
        context?.requestContext?.get(MASTRA_THREAD_ID_KEY),
      );
      return tasks.update(taskId, {
        ...(title != null ? { title } : {}),
        ...(goal != null ? { goal } : {}),
        ...(description != null ? { description } : {}),
      });
    },
  });
}

export function taskStatusTool(tasks: TasksService) {
  return createTool({
    id: 'set_task_status',
    description:
      'Set status for the overall task objective: in-progress while ongoing, needs-input when awaiting the user, completed when the whole request ends. Recurring monitoring stays in-progress between checks, including quiet checks. Pause its schedules before marking monitoring completed. A final answer alone does not change status.',
    inputSchema: jsonSchema<{ status: TaskStatus }>({
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['in-progress', 'needs-input', 'completed'],
        },
      },
      required: ['status'],
      additionalProperties: false,
    }),
    execute: async ({ status }, context) => {
      const taskId = taskIdFromThread(
        context?.requestContext?.get(MASTRA_THREAD_ID_KEY),
      );
      return tasks.update(taskId, { status });
    },
  });
}

export function taskScheduleTools(schedules: TaskSchedulesService) {
  const properties = {
    cron: {
      type: 'string' as const,
      minLength: 1,
      description: 'Recurring cron expression.',
    },
    timezone: {
      type: 'string' as const,
      minLength: 1,
      description: 'Explicit IANA timezone from user context.',
    },
    prompt: {
      type: 'string' as const,
      minLength: 1,
      description: 'Work to do at each tick, including notification criteria.',
    },
  };
  const currentTask = (
    context: { requestContext?: { get(key: string): unknown } } | undefined,
  ) => taskIdFromThread(context?.requestContext?.get(MASTRA_THREAD_ID_KEY));
  const management = (action: 'pause' | 'resume' | 'delete') =>
    createTool({
      id: action + '_task_schedule',
      description:
        action === 'pause'
          ? 'Pause future ticks of this task schedule; current work continues.'
          : action === 'resume'
            ? 'Resume this task schedule.'
            : 'Delete this task schedule.',
      inputSchema: jsonSchema<{ id: string }>({
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      }),
      execute: async ({ id }, context) =>
        schedules[action](currentTask(context), id),
    });
  return {
    create_task_schedule: createTool({
      id: 'create_task_schedule',
      description:
        'Schedule recurring execution on this task. Choose a reasonable cadence if omitted, and state the cadence, explicit timezone, and notification criteria. Use message timezone unless the user specifies another; ask when unavailable.',
      inputSchema: jsonSchema<ScheduleInput>({
        type: 'object',
        properties,
        required: ['cron', 'timezone', 'prompt'],
        additionalProperties: false,
      }),
      execute: async (input, context) =>
        schedules.create(currentTask(context), input),
    }),
    list_task_schedules: createTool({
      id: 'list_task_schedules',
      description: 'List active and paused schedules for this task.',
      inputSchema: jsonSchema<Record<string, never>>({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      execute: async (_, context) => ({
        schedules: await schedules.list(currentTask(context)),
      }),
    }),
    update_task_schedule: createTool({
      id: 'update_task_schedule',
      description:
        'Update this task schedule by ID. Preserve its timezone unless the user requests a change.',
      inputSchema: jsonSchema<Partial<ScheduleInput> & { id: string }>({
        type: 'object',
        properties: { id: { type: 'string' }, ...properties },
        required: ['id'],
        additionalProperties: false,
      }),
      execute: async ({ id, ...input }, context) =>
        schedules.update(currentTask(context), id, input),
    }),
    pause_task_schedule: management('pause'),
    resume_task_schedule: management('resume'),
    delete_task_schedule: management('delete'),
  };
}
