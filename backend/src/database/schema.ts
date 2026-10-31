import type { LoginInput, SecureFields } from '../login/login-fields.js';
import { DEFAULT_INSTANCE_SETTINGS } from '../instance-settings/instance-settings.types.js';
import type { DestinationRole } from '../delivery/destination.types.js';
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  timestamp,
  text,
  integer,
  boolean,
  bigserial,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { MessageMetadata, MessagePhase } from '../chat/chat.types.js';
import type { TaskStatus } from '../tasks/tasks.types.js';
import type { McpAuth } from '../mcp/mcp.types.js';
import type {
  PreferenceActor,
  PreferenceBasis,
  PreferenceSnapshot,
  PreferenceStatus,
} from '../preferences/preferences.types.js';

const identity = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
});
const mutable = () => ({
  ...identity(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
  version: integer('version').notNull().default(1),
});
export const mcpServers = pgTable('mcp_servers', {
  ...mutable(),
  name: text('name').notNull().unique(),
  url: text('url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  auth: jsonb('auth').$type<McpAuth>().notNull().default({ type: 'none' }),
  oauth: jsonb('oauth').$type<Record<string, string>>().notNull().default({}),
  authEpoch: integer('auth_epoch').notNull().default(1),
});
export const tasks = pgTable(
  'tasks',
  {
    ...mutable(),
    lastActivityAt: timestamp('last_activity_at', {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    title: text('title').notNull(),
    goal: text('goal').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<TaskStatus>().notNull().default('in-progress'),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [
    index('tasks_history_idx').on(
      t.archived,
      t.lastActivityAt.desc(),
      t.id.desc(),
    ),
    check(
      'task_status',
      sql`${t.status} in ('in-progress', 'needs-input', 'completed')`,
    ),
  ],
);
export const preferences = pgTable(
  'preferences',
  {
    ...mutable(),
    topic: text('topic').notNull(),
    statement: text('statement').notNull(),
    appliesWhen: text('applies_when'),
    basis: text('basis').$type<PreferenceBasis>().notNull(),
    sourceMessageIds: jsonb('source_message_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    status: text('status')
      .$type<PreferenceStatus>()
      .notNull()
      .default('active'),
  },
  (t) => [
    index('preferences_history_idx').on(
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    check(
      'preference_basis',
      sql`${t.basis} in ('user-stated', 'model-inferred')`,
    ),
    check('preference_status', sql`${t.status} in ('active', 'retired')`),
  ],
);
export const preferenceRevisions = pgTable(
  'preference_revisions',
  {
    preferenceId: uuid('preference_id')
      .notNull()
      .references(() => preferences.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<PreferenceSnapshot>().notNull(),
    actor: text('actor').$type<PreferenceActor>().notNull(),
    taskId: uuid('task_id').references(() => tasks.id),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.preferenceId, t.version] }),
    check('preference_revision_version', sql`${t.version} > 0`),
    check('preference_actor', sql`${t.actor} in ('human', 'main', 'task')`),
    check(
      'preference_actor_task',
      sql`(${t.actor} = 'task' and ${t.taskId} is not null) or (${t.actor} <> 'task' and ${t.taskId} is null)`,
    ),
  ],
);
export const attachments = pgTable(
  'attachments',
  {
    ...identity(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageFilename: text('storage_filename').notNull().unique(),
  },
  (t) => [check('attachment_size', sql`${t.sizeBytes} between 0 and 25000000`)],
);
export const instanceSettings = pgTable(
  'instance_settings',
  {
    id: integer('id').primaryKey().default(1),
    agentName: text('agent_name')
      .notNull()
      .default(DEFAULT_INSTANCE_SETTINGS.agentName),
    agentAvatarAttachmentId: uuid('agent_avatar_attachment_id').references(
      () => attachments.id,
    ),
    accentColor: text('accent_color')
      .notNull()
      .default(DEFAULT_INSTANCE_SETTINGS.accentColor),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    check('instance_settings_singleton', sql`${t.id} = 1`),
    check(
      'instance_settings_name',
      sql`length(btrim(${t.agentName})) between 1 and 60`,
    ),
    check('instance_settings_accent', sql`${t.accentColor} ~ '^#[0-9a-f]{6}$'`),
    check('instance_settings_version', sql`${t.version} > 0`),
  ],
);

export const destinations = pgTable(
  'destinations',
  {
    id: text('id').primaryKey(),
    adapterId: text('adapter_id').notNull(),
    role: text('role').$type<DestinationRole>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('destinations_adapter_idx').on(t.adapterId),
    check('destination_role', sql`${t.role} in ('canonical', 'secondary')`),
    check('destination_id', sql`${t.id} ~ '^[a-z][a-z0-9:_-]{0,99}$'`),
  ],
);
export const messages = pgTable(
  'messages',
  {
    ...mutable(),
    sequence: bigserial('sequence', { mode: 'number' }).notNull().unique(),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    idempotencyKey: text('idempotency_key'),
    source: text('source'),
    originDestinationId: text('origin_destination_id').references(
      () => destinations.id,
    ),
    mainVisible: boolean('main_visible').notNull().default(false),
    reaction: text('reaction'),
    deliveryDestinationIds: jsonb('delivery_destination_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    notificationDestinationIds: jsonb('notification_destination_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    replyToMessageId: uuid('reply_to_message_id').references(
      (): AnyPgColumn => messages.id,
    ),
    text: text('text').notNull(),
    metadata: jsonb('metadata').$type<MessageMetadata>().notNull().default({}),
    taskId: uuid('task_id').references(() => tasks.id),
    phase: text('phase').$type<MessagePhase>(),
    suggestedReplies: jsonb('suggested_replies')
      .$type<string[]>()
      .notNull()
      .default([]),
  },
  (t) => [
    index('messages_task_idx').on(t.taskId, t.sequence.desc()),
    index('messages_main_idx')
      .on(t.sequence.desc())
      .where(sql`${t.taskId} is null or ${t.mainVisible}`),
    check('message_role', sql`${t.role} in ('user', 'assistant')`),
    check(
      'message_source',
      sql`(${t.role} = 'user' and ${t.source} is not null) or (${t.role} = 'assistant' and ${t.source} is null and ${t.originDestinationId} is null)`,
    ),
    check(
      'message_notification_destinations',
      sql`jsonb_typeof(${t.notificationDestinationIds}) = 'array' and ${t.notificationDestinationIds} <@ ${t.deliveryDestinationIds} and (${t.notificationDestinationIds} = '[]'::jsonb or ${t.role} = 'assistant')`,
    ),
    check(
      'message_destinations',
      sql`jsonb_typeof(${t.deliveryDestinationIds}) = 'array' and (${t.role} = 'assistant' or (${t.deliveryDestinationIds} = '[]'::jsonb and ${t.notificationDestinationIds} = '[]'::jsonb))`,
    ),
    check(
      'message_phase',
      sql`${t.phase} is null or (${t.role} = 'assistant' and ${t.phase} in ('commentary', 'final_answer'))`,
    ),
  ],
);
export const messageAttachments = pgTable(
  'message_attachments',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => attachments.id),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.position] }),
    index('message_attachment_reference_idx').on(t.attachmentId),
  ],
);
export type DeliveryJobState =
  | 'pending'
  | 'sending'
  | 'accepted'
  | 'failed'
  | 'uncertain'
  | 'cancelled';

export const deliveryJobs = pgTable(
  'delivery_jobs',
  {
    ...identity(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id),
    adapterId: text('adapter_id').notNull(),
    notify: boolean('notify').notNull(),
    messageVersion: integer('message_version').notNull().default(1),
    reaction: text('reaction'),
    state: text('state').$type<DeliveryJobState>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    errorCode: text('error_code'),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('delivery_job_message_destination_idx').on(
      t.messageId,
      t.destinationId,
      t.messageVersion,
    ),
    index('delivery_job_dispatch_idx').on(t.state, t.nextAttemptAt),
    check(
      'delivery_job_state',
      sql`${t.state} in ('pending', 'sending', 'accepted', 'failed', 'uncertain', 'cancelled')`,
    ),
    check('delivery_job_attempts', sql`${t.attempts} >= 0`),
  ],
);

export type NotificationIntentState =
  | 'pending'
  | 'sending'
  | 'accepted'
  | 'failed'
  | 'uncertain'
  | 'cancelled'
  | 'expanded';

/** Provider-neutral work created atomically with a canonical message. */
export const notificationIntents = pgTable(
  'notification_intents',
  {
    ...identity(),
    sequence: bigserial('sequence', { mode: 'number' }).notNull().unique(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id),
    messageVersion: integer('message_version').notNull().default(1),
    reaction: text('reaction'),
    state: text('state')
      .$type<NotificationIntentState>()
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      precision: 3,
    }).notNull(),
    errorCode: text('error_code'),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('notification_intent_message_destination_idx').on(
      t.messageId,
      t.destinationId,
      t.messageVersion,
    ),
    index('notification_intent_publication_idx').on(
      t.destinationId,
      t.sequence,
    ),
    index('notification_intent_dispatch_idx').on(
      t.destinationId,
      t.state,
      t.nextAttemptAt,
    ),
    check(
      'notification_intent_state',
      sql`${t.state} in ('pending', 'sending', 'accepted', 'failed', 'uncertain', 'cancelled', 'expanded')`,
    ),
    check('notification_intent_attempts', sql`${t.attempts} >= 0`),
  ],
);

export const idempotency = pgTable(
  'idempotency',
  {
    operation: text('operation').notNull(),
    key: text('key').notNull(),
    request: jsonb('request').$type<Record<string, unknown>>().notNull(),
    response: jsonb('response').$type<{ messageId: string }>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.operation, t.key] })],
);

export const loginRequests = pgTable(
  'login_requests',
  {
    ...identity(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    origin: text('origin').notNull(),
    status: text('status')
      .$type<
        | 'pending'
        | 'saved'
        | 'selected'
        | 'filled'
        | 'cancelled'
        | 'updating'
        | 'failed'
      >()
      .notNull()
      .default('pending'),
    kind: text('kind')
      .$type<'credentials' | 'code' | 'card'>()
      .notNull()
      .default('credentials'),
    chooseAccount: boolean('choose_account').notNull().default(false),
    fields: jsonb('fields').$type<SecureFields>(),
    inspectionId: uuid('inspection_id').references(
      (): AnyPgColumn => loginInspections.id,
      { onDelete: 'set null' },
    ),
    cardId: uuid('card_id').notNull(),
    recoveryAttempts: integer('recovery_attempts').notNull().default(0),
    recoveryAt: timestamp('recovery_at', { withTimezone: true }),
    workerId: text('worker_id'),
    accountId: text('account_id'),
    keepMeSignedIn: boolean('keep_me_signed_in').notNull().default(false),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
  },
  (t) => [
    index('login_request_card_idx').on(t.cardId, t.createdAt.desc()),
    uniqueIndex('login_request_pending_idx')
      .on(t.taskId, t.origin, t.kind)
      .where(sql`${t.status} in ('pending','updating','failed')`),
    check(
      'login_request_kind',
      sql`${t.kind} in ('credentials','code','card')`,
    ),
    check(
      'login_request_status',
      sql`${t.status} in ('pending','saved','selected','filled','cancelled','updating','failed')`,
    ),
  ],
);

export const loginInspections = pgTable('login_inspections', {
  ...identity(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  origin: text('origin').notNull(),
  metadata: jsonb('metadata')
    .$type<{ inputs: LoginInput[] } | { targets: unknown[] }>()
    .notNull(),
  image: text('image').notNull(),
});

export const loginSites = pgTable('login_sites', {
  origin: text('origin').primaryKey(),
  lastAccountId: text('last_account_id'),
  keepMeSignedIn: boolean('keep_me_signed_in').notNull().default(false),
});

export const loginFlows = pgTable('login_flows', {
  owner: text('owner').primaryKey(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  origin: text('origin').notNull(),
  accountId: text('account_id').notNull(),
  keepMeSignedIn: boolean('keep_me_signed_in').notNull().default(false),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
