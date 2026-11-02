import { createTool } from '@mastra/core/tools';
import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { jsonSchema } from 'ai';
import { taskIdFromThread } from '../agent/task-tools.js';
import {
  WORKER_ID,
  PARENT_TASK_ID,
  INTERACTION_EXECUTION_ID,
} from '../agent/task-workers.js';
import type { LoginService } from './login.service.js';
import {
  cardRoles,
  inputRefPattern,
  normalizeFields,
  type CardRole,
} from './login-fields.js';
import { ApplicationError } from '../application/contracts/errors.js';

type FieldInput = Partial<Record<CardRole, string | null>> & {
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
    const executionId = context?.requestContext?.get(INTERACTION_EXECUTION_ID);
    return {
      taskId:
        typeof parent === 'string'
          ? parent
          : taskIdFromThread(
              context?.requestContext?.get(MASTRA_THREAD_ID_KEY),
            ),
      workerId: typeof workerId === 'string' ? workerId : undefined,
      executionId: typeof executionId === 'string' ? executionId : undefined,
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
  const refSchema = { type: 'string' as const, pattern: inputRefPattern };
  const fieldsSchema: Parameters<typeof jsonSchema>[0] = {
    type: 'object',
    properties: {
      ...Object.fromEntries(
        cardRoles.map((role) => [
          role,
          { type: ['string', 'null'], pattern: inputRefPattern },
        ]),
      ),
      username: { type: ['string', 'null'], pattern: inputRefPattern },
      password: { type: ['string', 'null'], pattern: inputRefPattern },
      code: {
        type: ['array', 'null'],
        items: { type: 'string', pattern: inputRefPattern },
        minItems: 1,
        maxItems: 64,
        uniqueItems: true,
      },
    },
    additionalProperties: false,
    anyOf: [
      {
        required: ['username'],
        properties: {
          username: refSchema,
        },
      },
      {
        required: ['password'],
        properties: {
          password: refSchema,
        },
      },
      {
        required: ['code'],
        properties: {
          code: {
            type: 'array',
            items: { type: 'string', pattern: inputRefPattern },
            minItems: 1,
          },
        },
      },
      ...cardRoles.map((role) => ({
        required: [role],
        properties: {
          [role]: refSchema,
        },
      })),
    ],
  };
  const keepSchema: Parameters<typeof jsonSchema>[0] = {
    type: ['boolean', 'null'],
    description:
      'Only supply when the user explicitly requests whether to stay signed in; otherwise reuse the stored website preference.',
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
    inspect_private_fields: createTool({
      id: 'inspect_private_fields',
      description:
        'Inspect private editable fields on the active browser or Android surface. First use an ordinary computer or Android tool to establish that surface. Returns opaque field refs, metadata, matching account labels and a screenshot. For Android only, supply the HTTPS account origin used for vault matching. Use the refs with enter_private_fields. Every call performs a fresh inspection; ordinary navigation invalidates earlier refs.',
      inputSchema: jsonSchema<{
        accountOrigin?: string | null;
      }>({
        type: 'object',
        properties: service.androidEnabled
          ? {
              accountOrigin: {
                type: ['string', 'null'],
                description:
                  'HTTPS account origin for Android vault matching, such as https://www.amazon.com. Omit for browser fields.',
              },
            }
          : {},
        additionalProperties: false,
      }),
      execute: ({ accountOrigin }, context) => {
        const { taskId, workerId, executionId } = identity(context);
        return safe(() =>
          service.inspectActive(
            taskId,
            workerId,
            executionId,
            accountOrigin ?? undefined,
            context?.abortSignal,
          ),
        );
      },
      outputSchema: jsonSchema<
        | Awaited<ReturnType<LoginService['inspectActive']>>
        | { status: 'error'; code: string; message: string }
      >({ type: 'object', additionalProperties: true }),
      toModelOutput: modelOutput,
    }),
    enter_private_fields: createTool({
      id: 'enter_private_fields',
      description:
        'Privately satisfy fields from the latest inspect_private_fields result. The host fills a current, remembered or sole saved login; opens an account picker when ambiguous or explicitly requested; and otherwise opens private entry. Codes always use private entry and payment fields use private entry or a saved-card picker. Pass only opaque refs, never labels or values. Filling never submits the page or proves authentication.',
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
              'Set true only when the user explicitly asks to choose or switch accounts.',
          },
          keepMeSignedIn: keepSchema,
        },
        required: ['fields'],
        additionalProperties: false,
      }),
      execute: ({ fields, chooseAccount, keepMeSignedIn }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() =>
          service.enter(
            taskId,
            normalizeFields(fields),
            workerId,
            keepMeSignedIn ?? undefined,
            chooseAccount ?? false,
            context?.abortSignal,
          ),
        );
      },
      outputSchema: jsonSchema<
        | Awaited<ReturnType<LoginService['enter']>>
        | { status: 'error'; code: string; message: string }
      >({ type: 'object', additionalProperties: true }),
      toModelOutput: modelOutput,
    }),
    confirm_authentication: createTool({
      id: 'confirm_authentication',
      description:
        'Confirm authentication only after the website or app has accepted the login and any challenges. The host records the selected account as successful. On an already authenticated browser page, an explicit keepMeSignedIn value records that preference even when no private login flow exists. This tool does not operate page controls or guarantee session retention.',
      inputSchema: jsonSchema<{
        keepMeSignedIn?: boolean | null;
      }>({
        type: 'object',
        properties: {
          keepMeSignedIn: keepSchema,
        },
        additionalProperties: false,
      }),
      execute: ({ keepMeSignedIn }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() =>
          service.confirm(taskId, workerId, keepMeSignedIn ?? undefined),
        );
      },
    }),
  };
}
