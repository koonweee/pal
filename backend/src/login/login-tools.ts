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
        'Inspect editable inputs in your selected browser tab. Optional action runs agent-browser arguments first, then returns the resulting masked inspection. Use action to open a login tab or perform any known next action that needs observation, including username, verification and Trust steps, so action and inspection share one call. It waits briefly for navigation; if the page is still loading, inspect again without repeating the action. Returns opaque refs, HTML metadata, matching accounts and a masked screenshot labelled i1, i2, etc.; each badge matches the ref prefix. Decide which inputs are username, password or verification code, then pass fields to secure_fill or secure_entry_request. Input roles are your judgment. Never read existing values. Reinspect after navigation or stale refs.',
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
        'Show one secure-entry card in Main and the owning Task conversation. Login entry collects the complete username/password once, saves it and fills the bound fields directly on submission; account selection also fills directly. If fields are stale, the save/selection is retained and completion tells you to inspect and fill fresh fields. Use secure_fill for additional fields on later pages. Verification entry collects only a code and fills it immediately without saving. Pass either username/password input refs or an ordered code-ref array from login_inspect. The selected roles determine the PWA form. Use chooseAccount true when the user asks to switch accounts without naming a specific saved account: shows saved accounts and Use a new account. Omit it for new or corrected credentials, even when matching accounts exist. Tell the user to use the inline form. The host sets the owning Task to needs-input; yield on awaiting_user without calling set_task_status. Workers report to their parent Task. The owning Task receives completion notification.',
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
        'Assign username/password roles to inspected input refs in fields and fill from the matching vault account without seeing values. Password refs must identify password inputs. For code, pass an ordered array of refs; a single input uses a one-element array. Reuse the same saved account across username/password stages; both credentials were collected together. Omit accountId by default: reuses the current flow, then last successful matching account, then sole match. Supply accountId only for an explicit user account choice. Ambiguous saved accounts open an inline picker, set the owning Task to needs-input and return awaiting_user; yield without calling set_task_status. For verification codes, input_required means call secure_entry_request. Returns the Keep me signed in preference for you to apply through website controls. Optional action runs agent-browser arguments only after a successful fill and returns the resulting masked inspection. Use a direct call with action for known fill/submit/inspect steps instead of generating a script. Waiting, input-required and failed fills never run action. After an action/inspection error, inspect without action before retrying. Without action this only fills; neither form proves login success. Call login_session with action complete after verifying authentication.',
      inputSchema: jsonSchema<{
        fields: FieldInput;
        accountId?: string | null;
        keepMeSignedIn?: boolean | null;
        action?: string[] | null;
      }>({
        type: 'object',
        properties: {
          fields: fieldsSchema,
          accountId: { type: ['string', 'null'] },
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
        "Use action complete only after verifying the website accepted this flow's login, including verification challenges; remembers its account for future logins. Saving/filling alone is not success. Use action preference with keepMeSignedIn for an explicit user instruction, including an existing authenticated session; this never marks an account successful. Preferences apply to this caller's login flow, or the selected HTTPS page if there is no flow. Inspect website persistence controls and honor the preference yourself; this tool neither operates them nor guarantees session persistence.",
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
