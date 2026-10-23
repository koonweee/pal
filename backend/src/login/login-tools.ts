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
  const keepSchema: Parameters<typeof jsonSchema>[0] = {
    type: ['boolean', 'null'],
    description:
      'Only supply when the user explicitly requests whether to stay signed in; otherwise reuse the stored website preference.',
  };
  const actionSchema: Parameters<typeof jsonSchema>[0] = {
    type: ['array', 'null'],
    items: { type: 'string' },
    minItems: 1,
    description:
      'Agent-browser arguments to run before inspecting, such as ["tab","new","https://example.com/login"] or ["click","@e4"].',
  };
  const modelOutput = (output: object) => {
    if (!('image' in output) || typeof output.image !== 'string')
      return { type: 'text' as const, value: JSON.stringify(output) };
    const { image, ...metadata } = output;
    return {
      type: 'content' as const,
      value: [
        { type: 'text' as const, text: JSON.stringify(metadata) },
        { type: 'media' as const, data: image, mediaType: 'image/png' },
      ],
    };
  };
  return {
    login_inspect: createTool({
      id: 'login_inspect',
      description:
        'Inspect editable inputs in your selected tab. Optional action runs agent-browser arguments before inspection. Returns opaque input refs, HTML metadata, matching account IDs/labels and a masked numbered screenshot. Assign username/password or ordered code refs to secure_fill or secure_entry_request. Never read existing values. Reinspect after navigation or stale refs; after a loading page or action failure inspect without repeating action.',
      inputSchema: jsonSchema<{ action?: string[] | null }>({
        type: 'object',
        properties: {
          action: actionSchema,
        },
        additionalProperties: false,
      }),
      execute: ({ action }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() =>
          service.inspect(
            taskId,
            workerId,
            action ?? undefined,
            context?.abortSignal,
          ),
        );
      },
      outputSchema: jsonSchema<
        | Awaited<ReturnType<LoginService['inspect']>>
        | { status: 'error'; code: string; message: string }
      >({ type: 'object', additionalProperties: true }),
      toModelOutput: modelOutput,
    }),
    secure_entry_request: createTool({
      id: 'secure_entry_request',
      description:
        'Show a private inline entry card in Main and Task. fields selects username/password entry or ordered verification-code inputs. Credential entry collects the complete login, saves it and fills bound fields; codes fill without storage. chooseAccount shows saved accounts and Use a new account. Returns awaiting_user; the host sets needs-input and notifies the owning Task after submission. Stale-field saves/selections remain available for fresh filling.',
      inputSchema: jsonSchema<{
        fields: FieldInput;
        chooseAccount?: boolean | null;
        keepMeSignedIn?: boolean | null;
      }>({
        type: 'object',
        properties: {
          fields: fieldsSchema,
          chooseAccount: {
            type: ['boolean', 'null'],
            description:
              'Show saved accounts and Use a new account for an explicit account-switch request.',
          },
          keepMeSignedIn: keepSchema,
        },
        required: ['fields'],
        additionalProperties: false,
      }),
      execute: ({ fields, chooseAccount, keepMeSignedIn }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() =>
          service.request(
            taskId,
            normalizeFields(fields),
            workerId,
            keepMeSignedIn ?? undefined,
            chooseAccount ?? false,
          ),
        );
      },
    }),
    secure_fill: createTool({
      id: 'secure_fill',
      description:
        'Fill inspected username/password refs from a matching vault account without exposing values; passwords require password inputs. Omit accountId for automatic reuse or an ambiguity picker. Code refs currently return input_required. Optional action runs only after successful filling and returns the resulting masked inspection. Waiting, input-required and failed fills never run action. After an action/inspection error, inspect without action before retrying. Without action only fills. Returns session-persistence intent; filling does not prove authentication.',
      inputSchema: jsonSchema<{
        fields: FieldInput;
        accountId?: string | null;
        keepMeSignedIn?: boolean | null;
        action?: string[] | null;
      }>({
        type: 'object',
        properties: {
          fields: fieldsSchema,
          accountId: {
            type: ['string', 'null'],
            description:
              'Only for an explicit user choice of a matching saved account.',
          },
          keepMeSignedIn: keepSchema,
          action: actionSchema,
        },
        required: ['fields'],
        additionalProperties: false,
      }),
      execute: ({ fields, accountId, keepMeSignedIn, action }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() =>
          service.fill(
            taskId,
            normalizeFields(fields),
            accountId ?? undefined,
            workerId,
            keepMeSignedIn ?? undefined,
            action ?? undefined,
            context?.abortSignal,
          ),
        );
      },
      outputSchema: jsonSchema<
        | Awaited<ReturnType<LoginService['fill']>>
        | { status: 'error'; code: string; message: string }
      >({ type: 'object', additionalProperties: true }),
      toModelOutput: modelOutput,
    }),
    login_session: createTool({
      id: 'login_session',
      description:
        'Record the selected flow account as successful with action complete, only after verifying website authentication and challenges. action preference records an explicit keepMeSignedIn instruction for this flow or the selected HTTPS page. This tool does not operate website persistence controls or guarantee session retention.',
      inputSchema: jsonSchema<{
        action: 'complete' | 'preference';
        keepMeSignedIn?: boolean | null;
      }>({
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['complete', 'preference'] },
          keepMeSignedIn: keepSchema,
        },
        required: ['action'],
        additionalProperties: false,
      }),
      execute: ({ action, keepMeSignedIn }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() =>
          service.session(
            taskId,
            action,
            workerId,
            keepMeSignedIn ?? undefined,
          ),
        );
      },
    }),
  };
}
