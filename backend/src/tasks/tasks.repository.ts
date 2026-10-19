import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import {
  DatabaseService,
  type Executor,
  type Transaction,
} from '../database/database.service.js';
import { tasks } from '../database/schema.js';
import type { Task, TaskSearchCursor } from './tasks.types.js';
export type TaskRecord = typeof tasks.$inferSelect;
export function taskView(row: TaskRecord): Task {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    lastActivityAt: row.lastActivityAt.toISOString(),
    title: row.title,
    goal: row.goal,
    status: row.status,
    archived: row.archived,
  };
}
@Injectable()
export class TasksRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  activityTasks() {
    return this.database.db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        archived: tasks.archived,
        version: tasks.version,
      })
      .from(tasks)
      .where(eq(tasks.archived, false));
  }
  async get(id: string, db: Executor = this.database.db) {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    return row;
  }
  async lock(id: string, tx: Transaction) {
    const [row] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .for('update');
    return row;
  }
  async create(input: typeof tasks.$inferInsert, tx: Transaction) {
    const [row] = await tx.insert(tasks).values(input).returning();
    return row;
  }
  async update(
    id: string,
    input: Partial<
      Pick<TaskRecord, 'title' | 'goal' | 'description' | 'status' | 'archived'>
    >,
    tx: Transaction,
  ) {
    const now = new Date();
    const [row] = await tx
      .update(tasks)
      .set({
        ...input,
        version: sql`${tasks.version} + 1`,
        updatedAt: now,
        lastActivityAt: now,
      })
      .where(eq(tasks.id, id))
      .returning();
    return row;
  }
  async recordActivity(id: string, at: Date, tx: Transaction) {
    const [row] = await tx
      .update(tasks)
      .set({
        lastActivityAt: sql`greatest(${tasks.lastActivityAt}, ${at})`,
        version: sql`${tasks.version} + 1`,
      })
      .where(eq(tasks.id, id))
      .returning();
    return row;
  }
  async search(queries: string[], limit: number, cursor?: TaskSearchCursor) {
    const fields = [tasks.title, tasks.goal, tasks.description];
    const matches = queries.map((query) =>
      and(
        ...query.split(/\s+/).map((term) => {
          const pattern = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
          return or(...fields.map((field) => sql`${field} ilike ${pattern}`));
        }),
      )!,
    );
    return this.database.db
      .select()
      .from(tasks)
      .where(
        and(
          or(...matches),
          cursor
            ? sql`(${tasks.createdAt}, ${tasks.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(limit + 1);
  }
  list(
    archived: boolean,
    limit: number,
    cursor?: { lastActivityAt: string; id: string },
  ) {
    return this.database.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.archived, archived),
          cursor
            ? sql`(${tasks.lastActivityAt}, ${tasks.id}) < (${cursor.lastActivityAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(tasks.lastActivityAt), desc(tasks.id))
      .limit(limit + 1);
  }
}
