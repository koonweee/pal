import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

import { notificationIntents, type NotificationIntentState } from './schema.js';

/** Registration state owned by the native-notification adapter. */
export const nativeInstallations = pgTable(
  'native_installations',
  {
    id: text('id').primaryKey(),
    destinationId: text('destination_id').notNull(),
    provider: text('provider').notNull(),
    token: text('token').notNull(),
    environment: text('environment')
      .$type<'development' | 'production'>()
      .notNull(),
    generation: integer('generation').notNull().default(1),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'native_installation_environment',
      sql`${t.environment} in ('development', 'production')`,
    ),
    check('native_installation_generation', sql`${t.generation} > 0`),
  ],
);

/** Registration and per-subscription delivery state owned by the Web Push adapter. */
export const webPushInstallations = pgTable(
  'web_push_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    generation: integer('generation').notNull().default(1),
    seenSequence: bigint('seen_sequence', { mode: 'number' })
      .notNull()
      .default(0),
    enabled: boolean('enabled').notNull().default(true),
    activatedAt: timestamp('activated_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [check('web_push_installation_generation', sql`${t.generation} > 0`)],
);

export const webPushDeliveries = pgTable(
  'web_push_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => notificationIntents.id, { onDelete: 'cascade' }),
    installationId: uuid('installation_id')
      .notNull()
      .references(() => webPushInstallations.id, { onDelete: 'cascade' }),
    generation: integer('generation').notNull(),
    state: text('state')
      .$type<Exclude<NotificationIntentState, 'expanded'>>()
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('web_push_delivery_intent_installation_idx').on(
      t.intentId,
      t.installationId,
    ),
    index('web_push_delivery_dispatch_idx').on(t.state, t.nextAttemptAt),
    check(
      'web_push_delivery_state',
      sql`${t.state} in ('pending', 'sending', 'accepted', 'failed', 'uncertain', 'cancelled')`,
    ),
    check('web_push_delivery_attempts', sql`${t.attempts} >= 0`),
  ],
);
