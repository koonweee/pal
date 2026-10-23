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
        'Foreground and inspect your selected browser tab for login or verification-code targets and matching accounts. Returns metadata and a masked annotated screenshot. Never read existing credential values. Call again after navigation or stale targets.',
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
    secure_entry_request: createTool({
      id: 'secure_entry_request',
      description:
        'Open secure entry under the owning Task’s Logins button in the PWA. Login entry collects the complete username/password once and saves it; use secure_fill for later stages. Verification entry collects only a code and fills it immediately without saving. The backend chooses the form from targetRef. If credentials_available is returned, use secure_fill. Yield while awaiting input; workers report to their parent Task. The owning Task receives completion notification.',
      inputSchema: jsonSchema<{ targetRef: string }>({
        type: 'object',
        properties: { targetRef: { type: 'string' } },
        required: ['targetRef'],
        additionalProperties: false,
      }),
      execute: ({ targetRef }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() => service.request(taskId, targetRef, workerId));
      },
    }),
    secure_fill: createTool({
      id: 'secure_fill',
      description:
        'Fill a fresh inspected target from the matching vault account without seeing values. Reuse the same saved account across username/password stages; both credentials were collected together. Omit accountId when one account matches or this browser flow already selected it. For verification codes, input_required means call secure_entry_request. Does not click submit or prove login success.',
      inputSchema: jsonSchema<{ targetRef: string; accountId?: string }>({
        type: 'object',
        properties: {
          targetRef: { type: 'string' },
          accountId: { type: 'string' },
        },
        required: ['targetRef'],
        additionalProperties: false,
      }),
      execute: ({ targetRef, accountId }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() => service.fill(taskId, targetRef, accountId, workerId));
      },
    }),
  };
}
