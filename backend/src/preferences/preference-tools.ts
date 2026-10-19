import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { jsonSchema } from 'ai';
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';
import { taskIdFromThread } from '../agent/task-tools.js';
import {
  PreferenceConflictException,
  PreferencesService,
} from './preferences.service.js';
import {
  PREFERENCE_BASIS_VALUES,
  PREFERENCE_LIMITS,
  PREFERENCE_STATUS_VALUES,
  type PreferenceBasis,
  type PreferenceStatus,
  type PreferenceWriteActor,
} from './preferences.types.js';

type ReadInput =
  | {
      operation: 'search';
      queries?: string[];
      topic?: string;
      status?: PreferenceStatus;
      after?: string;
      limit?: number;
    }
  | { operation: 'get'; id: string }
  | {
      operation: 'history';
      id: string;
      after?: string;
      limit?: number;
    };

type WriteInput =
  | {
      operation: 'create';
      topic: string;
      statement: string;
      appliesWhen?: string | null;
      basis: PreferenceBasis;
      sourceMessageRefs: number[];
      reason: string;
    }
  | {
      operation: 'update';
      id: string;
      expectedVersion: number;
      topic?: string;
      statement?: string;
      appliesWhen?: string | null;
      basis?: PreferenceBasis;
      sourceMessageRefs?: number[];
      status?: PreferenceStatus;
      reason: string;
    };

const cursorSchema: JSONSchema7 = {
  type: 'string',
  maxLength: PREFERENCE_LIMITS.cursor,
};
const pageLimitSchema: JSONSchema7 = {
  type: 'integer',
  minimum: 1,
  maximum: PREFERENCE_LIMITS.page,
};
const idSchema: JSONSchema7 = { type: 'string', format: 'uuid' };
const topicSchema: JSONSchema7 = {
  type: 'string',
  minLength: 1,
  maxLength: PREFERENCE_LIMITS.topic,
};
const statementSchema: JSONSchema7 = {
  type: 'string',
  minLength: 1,
  maxLength: PREFERENCE_LIMITS.statement,
};
const appliesWhenSchema: JSONSchema7 = {
  type: ['string', 'null'],
  maxLength: PREFERENCE_LIMITS.appliesWhen,
};
const basisSchema: JSONSchema7 = {
  type: 'string',
  enum: [...PREFERENCE_BASIS_VALUES],
};
const statusSchema: JSONSchema7 = {
  type: 'string',
  enum: [...PREFERENCE_STATUS_VALUES],
};
const reasonSchema: JSONSchema7 = {
  type: 'string',
  minLength: 1,
  maxLength: PREFERENCE_LIMITS.reason,
};
const sourceMessageRefsSchema: JSONSchema7 = {
  type: 'array',
  minItems: 1,
  maxItems: PREFERENCE_LIMITS.sources,
  uniqueItems: true,
  items: { type: 'integer', minimum: 1 },
};
const expectedVersionSchema: JSONSchema7 = {
  type: 'integer',
  minimum: 1,
};

function operationSchema(
  operation: ReadInput['operation'] | WriteInput['operation'],
  properties: Record<string, JSONSchema7Definition> = {},
  required: string[] = [],
): JSONSchema7 {
  return {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: [operation] },
      ...properties,
    },
    required: ['operation', ...required],
    additionalProperties: false,
  };
}

const updateProperties = {
  id: idSchema,
  expectedVersion: expectedVersionSchema,
  topic: topicSchema,
  statement: statementSchema,
  appliesWhen: appliesWhenSchema,
  basis: basisSchema,
  sourceMessageRefs: sourceMessageRefsSchema,
  status: statusSchema,
  reason: reasonSchema,
};

export function preferenceReadTool(preferences: PreferencesService) {
  return createTool({
    id: 'read_preferences',
    description:
      'Read the current shared preference notebook only when the request involves the user’s tastes, habits, constraints, or preferred way of working. Search accepts up to five alternative literal queries; broaden terms after an empty result. Get returns one current record and its source summaries. History returns audited revisions.',
    inputSchema: jsonSchema<ReadInput>({
      type: 'object',
      oneOf: [
        operationSchema('search', {
          queries: {
            type: 'array',
            maxItems: PREFERENCE_LIMITS.queries,
            items: {
              type: 'string',
              minLength: 1,
              maxLength: PREFERENCE_LIMITS.query,
            },
          },
          topic: topicSchema,
          status: statusSchema,
          after: cursorSchema,
          limit: pageLimitSchema,
        }),
        operationSchema('get', { id: idSchema }, ['id']),
        operationSchema(
          'history',
          { id: idSchema, after: cursorSchema, limit: pageLimitSchema },
          ['id'],
        ),
      ],
    }),
    execute: async (input) => {
      if (input.operation === 'search') return preferences.search(input);
      if (input.operation === 'get')
        return { preference: await preferences.get(input.id) };
      return preferences.history(input.id, input);
    },
  });
}

export function preferenceWriteTool(
  preferences: PreferencesService,
  actor: (
    context: { requestContext?: { get(key: string): unknown } } | undefined,
  ) => PreferenceWriteActor,
) {
  return createTool({
    id: 'update_preference',
    description:
      'Create or update one durable user preference. Search first to avoid duplicates. Cite public user-message refs as evidence. Save clear lasting statements and corrections; use model-inferred only for a narrow inference supported by repeated evidence. Keep one-off requests in task context. Expected version prevents silent overwrites. A conflict returns the current record for reconsideration.',
    inputSchema: jsonSchema<WriteInput>({
      type: 'object',
      oneOf: [
        operationSchema(
          'create',
          {
            topic: topicSchema,
            statement: statementSchema,
            appliesWhen: appliesWhenSchema,
            basis: basisSchema,
            sourceMessageRefs: sourceMessageRefsSchema,
            reason: reasonSchema,
          },
          ['topic', 'statement', 'basis', 'sourceMessageRefs', 'reason'],
        ),
        operationSchema('update', updateProperties, [
          'id',
          'expectedVersion',
          'status',
          'reason',
        ]),
        operationSchema('update', updateProperties, [
          'id',
          'expectedVersion',
          'sourceMessageRefs',
          'reason',
        ]),
      ],
    }),
    execute: async (input, context) => {
      try {
        if (input.operation === 'create') {
          const sourceMessageIds = await preferences.resolveSourceSequences(
            input.sourceMessageRefs,
          );
          return {
            preference: await preferences.create(
              { ...input, sourceMessageIds },
              actor(context),
            ),
          };
        }
        const sourceMessageIds =
          input.sourceMessageRefs === undefined
            ? undefined
            : await preferences.resolveSourceSequences(input.sourceMessageRefs);
        return {
          preference: await preferences.update(
            input.id,
            { ...input, sourceMessageIds },
            actor(context),
          ),
        };
      } catch (error) {
        if (error instanceof PreferenceConflictException)
          return { conflict: true, current: error.current };
        throw error;
      }
    },
  });
}

export const mainPreferenceActor = () => ({ actor: 'main' as const });

export const taskPreferenceActor = (
  context: { requestContext?: { get(key: string): unknown } } | undefined,
) => ({
  actor: 'task' as const,
  taskId: taskIdFromThread(context?.requestContext?.get(MASTRA_THREAD_ID_KEY)),
});
