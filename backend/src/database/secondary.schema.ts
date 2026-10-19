import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { destinations, messages } from './schema.js';

/** Tables owned by the shared secondary-adapter infrastructure. */
export const externalMessageReferences = pgTable(
  'external_message_references',
  {
    adapterId: text('adapter_id').notNull(),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id),
    externalMessageId: text('external_message_id').notNull(),
    externalThreadId: text('external_thread_id'),
    canonicalMessageId: uuid('canonical_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    direction: text('direction').$type<'incoming' | 'outgoing'>().notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.adapterId, t.destinationId, t.externalMessageId],
    }),
    uniqueIndex('external_reference_canonical_position_idx').on(
      t.adapterId,
      t.destinationId,
      t.canonicalMessageId,
      t.direction,
      t.position,
    ),
    index('external_reference_canonical_idx').on(
      t.adapterId,
      t.destinationId,
      t.canonicalMessageId,
    ),
    check(
      'external_reference_direction',
      sql`${t.direction} in ('incoming', 'outgoing')`,
    ),
    check('external_reference_position', sql`${t.position} >= 0`),
  ],
);

export const secondaryInputs = pgTable(
  'secondary_inputs',
  {
    adapterId: text('adapter_id').notNull(),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id),
    externalEventId: text('external_event_id').notNull(),
    canonicalMessageId: uuid('canonical_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.adapterId, t.destinationId, t.externalEventId] }),
  ],
);

export const adapterState = pgTable(
  'adapter_state',
  {
    adapterId: text('adapter_id').notNull(),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id),
    key: text('key').notNull(),
    value: jsonb('value').$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.adapterId, t.destinationId, t.key] })],
);
