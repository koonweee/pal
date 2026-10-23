import { createTool } from '@mastra/core/tools';
import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { jsonSchema } from 'ai';
import { taskIdFromThread } from '../agent/task-tools.js';
import { WORKER_ID, PARENT_TASK_ID } from '../agent/task-workers.js';
import type { LoginService } from './login.service.js';
import { ApplicationError } from '../application/contracts/errors.js';

export function loginTools(service: LoginService) {
  const identity = (
    context: { requestContext?: { get(key: string): unknown } } | undefined,
  ) => {
    const workerId = context?.requestContext?.get(WORKER_ID);
    const parent = context?.requestContext?.get(PARENT_TASK_ID);
    return {
      taskId:
        typeof parent === 'string'
          ? parent
          : taskIdFromThread(
              context?.requestContext?.get(MASTRA_THREAD_ID_KEY),
            ),
      workerId: typeof workerId === 'string' ? workerId : undefined,
    };
  };
  const safe = async <T>(work: () => Promise<T>) => {
    try {
      return await work();
    } catch (error) {
      return {
        status: 'error' as const,
        code: error instanceof ApplicationError ? error.code : 'unavailable',
        message:
          error instanceof ApplicationError
            ? error.message
            : 'Login operation failed',
      };
    }
  };
  return {
    login_inspect: createTool({
      id: 'login_inspect',
      description:
        'Foreground and inspect your selected browser tab for login targets and matching accounts. Returns metadata and a masked annotated screenshot. Never read existing credential values. Call again after navigation or stale targets.',
      inputSchema: jsonSchema<Record<string, never>>({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      execute: (_input, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() => service.inspect(taskId, workerId));
      },
      outputSchema: jsonSchema<
        | Awaited<ReturnType<LoginService['inspect']>>
        | { status: 'error'; code: string; message: string }
      >({ type: 'object', additionalProperties: true }),
      toModelOutput: (output) => {
        if (!('image' in output))
          return { type: 'text' as const, value: JSON.stringify(output) };
        const { image, ...metadata } = output;
        return {
          type: 'content' as const,
          value: [
            { type: 'text' as const, text: JSON.stringify(metadata) },
            { type: 'media' as const, data: image, mediaType: 'image/png' },
          ],
        };
      },
    }),
    login_request: createTool({
      id: 'login_request',
      description:
        'Request secure PWA entry for a detected login target. The user submits directly to the backend. Return control while awaiting input; workers report the request to their parent Task. The owning Task receives saved/cancelled notification.',
      inputSchema: jsonSchema<{ loginRef: string }>({
        type: 'object',
        properties: { loginRef: { type: 'string' } },
        required: ['loginRef'],
        additionalProperties: false,
      }),
      execute: ({ loginRef }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() => service.request(taskId, loginRef, workerId));
      },
    }),
    login_fill: createTool({
      id: 'login_fill',
      description:
        'Fill a fresh detected login target from Bitwarden without seeing credential values. Omit accountId only when exactly one account matches. Does not submit or prove login success.',
      inputSchema: jsonSchema<{ loginRef: string; accountId?: string }>({
        type: 'object',
        properties: {
          loginRef: { type: 'string' },
          accountId: { type: 'string' },
        },
        required: ['loginRef'],
        additionalProperties: false,
      }),
      execute: ({ loginRef, accountId }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() => service.fill(taskId, loginRef, accountId, workerId));
      },
    }),
  };
}
