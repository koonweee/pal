import { createTool } from '@mastra/core/tools';
import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { jsonSchema } from 'ai';
import { taskIdFromThread } from '../agent/task-tools.js';
import { WORKER_ID, PARENT_TASK_ID } from '../agent/task-workers.js';
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
    login_inspect: createTool({
      id: 'login_inspect',
      description:
        'Inspect editable inputs in your selected browser tab or target Android phone. Returns opaque input refs, field metadata, matching account IDs/labels and a screenshot (masked for browser, unmasked for Android). For Android, supply the account website for vault matching; installed apps require no registration. Assign username/password, ordered code refs, or cardholderName/number/expiry/expMonth/expYear/securityCode refs to secure_fill or secure_entry_request. Never read existing values. Reinspect after navigation or stale refs; after a loading page inspect again.',
      inputSchema: jsonSchema<{
        target?: 'browser' | 'android' | null;
        website?: string | null;
      }>({
        type: 'object',
        properties: service.androidEnabled
          ? {
              website: {
                type: ['string', 'null'],
                description:
                  'HTTPS account website for Android vault matching, such as https://www.amazon.com. Required for Android; browser uses its actual page origin.',
              },
              target: {
                type: ['string', 'null'],
                enum: ['browser', 'android', null],
                description:
                  'Browser by default; Android inspects the configured phone.',
              },
            }
          : {},
        additionalProperties: false,
      }),
      execute: ({ target, website }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() =>
          service.inspect(
            taskId,
            workerId,
            undefined,
            context?.abortSignal,
            target ?? 'browser',
            website ?? undefined,
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
        'Show a private inline entry card in Main and Task. Pass only opaque refs from the latest login_inspect; never pass labels or values. fields selects login, code, or payment entry and the card requests only those roles. Staged username and password/PIN requests merge into one vault account; codes stay transient. Never mix role kinds. chooseAccount shows saved login accounts or Bitwarden cards. Returns awaiting_user; the host sets needs-input and notifies the owning Task after submission. Stale-field saves/selections remain available for fresh filling.',
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
              'Show the saved-item picker for login or payment entry.',
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
        'Fill inspected username/password refs from a matching vault account without exposing values. Pass only opaque refs from the latest login_inspect; never pass labels or values. Password and reusable PIN roles require password inputs. Omit accountId for automatic reuse or an ambiguity picker. Code refs return input_required. Card refs open the private card picker; omit accountId and keepMeSignedIn for cards. Card filling never submits a purchase. Filling does not click submit; continue with computer or Android tools after filling. Android accepts login/code fields; omit keepMeSignedIn. Returns session-persistence intent; filling does not prove authentication.',
      inputSchema: jsonSchema<{
        fields: FieldInput;
        accountId?: string | null;
        keepMeSignedIn?: boolean | null;
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
        },
        required: ['fields'],
        additionalProperties: false,
      }),
      execute: ({ fields, accountId, keepMeSignedIn }, context) => {
        const { taskId, workerId } = identity(context);
        return safe(() =>
          service.fill(
            taskId,
            normalizeFields(fields),
            accountId ?? undefined,
            workerId,
            keepMeSignedIn ?? undefined,
            undefined,
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
