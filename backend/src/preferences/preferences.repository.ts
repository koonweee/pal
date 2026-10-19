import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  DatabaseService,
  type Executor,
  type Transaction,
} from '../database/database.service.js';
import {
  messages,
  preferenceRevisions,
  preferences,
} from '../database/schema.js';
import type {
  PreferenceSearchCursor,
  PreferenceSnapshot,
  PreferenceStatus,
} from './preferences.types.js';

export type PreferenceRecord = typeof preferences.$inferSelect;

@Injectable()
export class PreferencesRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async get(id: string, db: Executor = this.database.db) {
    const [row] = await db
      .select()
      .from(preferences)
      .where(eq(preferences.id, id));
    return row;
  }

  async lock(id: string, tx: Transaction) {
    const [row] = await tx
      .select()
      .from(preferences)
      .where(eq(preferences.id, id))
      .for('update');
    return row;
  }

  async create(input: typeof preferences.$inferInsert, tx: Transaction) {
    const [row] = await tx.insert(preferences).values(input).returning();
    return row;
  }

  async update(
    id: string,
    input: Partial<
      Pick<
        PreferenceRecord,
        | 'topic'
        | 'statement'
        | 'appliesWhen'
        | 'basis'
        | 'sourceMessageIds'
        | 'status'
      >
    >,
    tx: Transaction,
  ) {
    const [row] = await tx
      .update(preferences)
      .set({
        ...input,
        version: sql`${preferences.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(preferences.id, id))
      .returning();
    return row;
  }

  async addRevision(
    input: {
      preferenceId: string;
      version: number;
      snapshot: PreferenceSnapshot;
      actor: 'human' | 'main' | 'task';
      taskId: string | null;
      reason: string;
    },
    tx: Transaction,
  ) {
    const [row] = await tx
      .insert(preferenceRevisions)
      .values(input)
      .returning();
    return row;
  }

  async sources(ids: string[], db: Executor = this.database.db) {
    if (!ids.length) return [];
    return db
      .select({
        id: messages.id,
        sequence: messages.sequence,
        taskId: messages.taskId,
        createdAt: messages.createdAt,
        role: messages.role,
        text: messages.text,
      })
      .from(messages)
      .where(inArray(messages.id, ids));
  }

  async sourcesBySequence(
    sequences: number[],
    db: Executor = this.database.db,
  ) {
    if (!sequences.length) return [];
    return db
      .select({
        id: messages.id,
        sequence: messages.sequence,
        taskId: messages.taskId,
        createdAt: messages.createdAt,
        role: messages.role,
        text: messages.text,
      })
      .from(messages)
      .where(inArray(messages.sequence, sequences));
  }

  search(options: {
    queries: string[];
    topic: string | null;
    status: PreferenceStatus;
    limit: number;
    cursor?: PreferenceSearchCursor;
  }) {
    const fields = [
      preferences.topic,
      preferences.statement,
      preferences.appliesWhen,
    ];
    const matches = options.queries.map((query) =>
      and(
        ...query.split(/\s+/).map((term) => {
          const pattern = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
          return or(
            ...fields.map(
              (field) => sql`coalesce(${field}, '') ilike ${pattern}`,
            ),
          );
        }),
      ),
    );
    return this.database.db
      .select()
      .from(preferences)
      .where(
        and(
          eq(preferences.status, options.status),
          options.topic
            ? sql`lower(${preferences.topic}) = ${options.topic.toLowerCase()}`
            : undefined,
          matches.length ? or(...matches) : undefined,
          options.cursor
            ? sql`(${preferences.createdAt}, ${preferences.id}) < (${options.cursor.createdAt}::timestamptz, ${options.cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(preferences.createdAt), desc(preferences.id))
      .limit(options.limit + 1);
  }

  history(id: string, limit: number, beforeVersion?: number) {
    return this.database.db
      .select()
      .from(preferenceRevisions)
      .where(
        and(
          eq(preferenceRevisions.preferenceId, id),
          beforeVersion
            ? sql`${preferenceRevisions.version} < ${beforeVersion}`
            : undefined,
        ),
      )
      .orderBy(desc(preferenceRevisions.version))
      .limit(limit + 1);
  }
}
