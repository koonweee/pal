import { createTool } from '@mastra/core/tools';
import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { jsonSchema } from 'ai';
import { taskIdFromThread } from '../agent/task-tools.js';
import { WORKER_ID, PARENT_TASK_ID } from '../agent/task-workers.js';
import type { LoginService } from './login.service.js';
import { normalizeFields } from './login-fields.js';
import { ApplicationError } from '../application/contracts/errors.js';

type FieldInput = {
  username?: string | null;
  password?: string | null;
  code?: string[] | null;
};

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
  const fieldsSchema: Parameters<typeof jsonSchema>[0] = {
    type: 'object',
    properties: {
      username: { type: ['string', 'null'] },
      password: { type: ['string', 'null'] },
      code: {
        type: ['array', 'null'],
        items: { type: 'string' },
        minItems: 1,
        maxItems: 64,
        uniqueItems: true,
      },
    },
    additionalProperties: false,
    anyOf: [
      { required: ['username'] },
      { required: ['password'] },
      { required: ['code'] },
    ],
  };
  return {
    login_inspect: createTool({
      id: 'login_inspect',
      description:
        'Inspect editable inputs in your selected browser tab. Returns opaque refs, HTML metadata, matching accounts and a masked screenshot labelled i1, i2, etc.; each badge matches the ref prefix. Decide which inputs are username, password or verification code, then pass fields to secure_fill or secure_entry_request. Input roles are your judgment. Never read existing values. Reinspect after navigation or stale refs.',
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
        'Show one secure-entry card in Main and the owning Task conversation. Login entry collects the complete username/password once and saves it; use secure_fill for later stages. Verification entry collects only a code and fills it immediately without saving. Pass either username/password input refs or an ordered code-ref array from login_inspect. The selected roles determine the PWA form. If credentials_available is returned, use secure_fill. Tell the user to use the inline form. Yield while awaiting input; workers report to their parent Task. The owning Task receives completion notification.',
      inputSchema: jsonSchema<{ fields: FieldInput }>({
        type: 'object',
        properties: { fields: fieldsSchema },
        required: ['fields'],
        additionalProperties: false,
      }),
      execute: ({ fields }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() =>
          service.request(taskId, normalizeFields(fields), workerId),
        );
      },
    }),
    secure_fill: createTool({
      id: 'secure_fill',
      description:
        'Assign username/password roles to inspected input refs in fields and fill from the matching vault account without seeing values. Password refs must identify password inputs. For code, pass an ordered array of refs; a single input uses a one-element array. Reuse the same saved account across username/password stages; both credentials were collected together. Omit accountId when one account matches or this browser flow already selected it. For verification codes, input_required means call secure_entry_request. Does not click submit or prove login success.',
      inputSchema: jsonSchema<{
        fields: FieldInput;
        accountId?: string | null;
      }>({
        type: 'object',
        properties: {
          fields: fieldsSchema,
          accountId: { type: ['string', 'null'] },
        },
        required: ['fields'],
        additionalProperties: false,
      }),
      execute: ({ fields, accountId }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() =>
          service.fill(
            taskId,
            normalizeFields(fields),
            accountId ?? undefined,
            workerId,
          ),
        );
      },
    }),
  };
}
