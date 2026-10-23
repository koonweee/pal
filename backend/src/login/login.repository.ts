import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, ne, isNull, inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { loginInspections, loginRequests } from '../database/schema.js';
import { ApplicationError } from '../application/contracts/errors.js';
import {
  StaleSecureFieldsError,
  type LoginInput,
  type SecureFields,
} from './login-fields.js';

export type LoginRequest = typeof loginRequests.$inferSelect;
const active = ['pending', 'updating', 'failed'] as const;

@Injectable()
export class LoginRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async request(
    taskId: string,
    origin: string,
    kind: 'credentials' | 'code' = 'credentials',
    fields?: SecureFields,
    workerId?: string,
    inspectionId?: string,
  ): Promise<LoginRequest> {
    return this.database.transaction(async (tx) => {
      const id = randomUUID();
      const [created] = await tx
        .insert(loginRequests)
        .values({
          id,
          cardId: id,
          taskId,
          origin,
          kind,
          fields,
          workerId,
          inspectionId,
        })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
      const [existing] = await tx
        .select()
        .from(loginRequests)
        .where(
          and(
            eq(loginRequests.taskId, taskId),
            eq(loginRequests.origin, origin),
            eq(loginRequests.kind, kind),
            inArray(loginRequests.status, active),
          ),
        )
        .for('update');
      if (!existing)
        throw new ApplicationError(
          'conflict',
          'Secure request changed; try again',
        );
      if (existing.status === 'failed')
        throw new ApplicationError(
          'conflict',
          'Automatic secure entry recovery stopped. The user can retry the inline card.',
        );
      if (
        existing.status === 'pending' &&
        (kind === 'credentials' ||
          JSON.stringify(existing.fields) === JSON.stringify(fields))
      )
        return existing;
      // New bindings get a new ID: an old submitted draft cannot be retargeted.
      await tx
        .update(loginRequests)
        .set({ status: 'cancelled', notifiedAt: new Date() })
        .where(eq(loginRequests.id, existing.id));
      const [row] = await tx
        .insert(loginRequests)
        .values({
          taskId,
          origin,
          kind,
          fields,
          workerId,
          inspectionId,
          cardId: existing.cardId,
          recoveryAttempts: existing.recoveryAttempts,
          createdAt: new Date(
            Math.max(Date.now(), existing.createdAt.getTime() + 1),
          ),
        })
        .returning();
      return row;
    });
  }
  async inspection(
    taskId: string,
    origin: string,
    inputs: LoginInput[],
    image: Buffer,
    id = randomUUID(),
  ) {
    await this.database.db.insert(loginInspections).values({
      id,
      taskId,
      origin,
      metadata: { inputs },
      image: image.toString('base64'),
    });
    return id;
  }
  async get(id: string) {
    const [row] = await this.database.db
      .select()
      .from(loginRequests)
      .where(eq(loginRequests.id, id));
    if (!row)
      throw new ApplicationError('not_found', 'Secure entry request not found');
    return row;
  }
  async current(id: string) {
    const original = await this.get(id);
    const [row] = await this.database.db
      .select()
      .from(loginRequests)
      .where(eq(loginRequests.cardId, original.cardId))
      .orderBy(desc(loginRequests.createdAt))
      .limit(1);
    return row;
  }
  async active() {
    return this.database.db
      .select()
      .from(loginRequests)
      .where(inArray(loginRequests.status, active))
      .orderBy(desc(loginRequests.createdAt));
  }
  async preview(id: string) {
    const [row] = await this.database.db
      .select({ image: loginInspections.image, at: loginInspections.createdAt })
      .from(loginInspections)
      .where(eq(loginInspections.id, id));
    if (!row || Date.now() - row.at.getTime() > 24 * 3600_000)
      throw new ApplicationError('not_found', 'Inspection expired');
    return Buffer.from(row.image, 'base64');
  }
  async finish(
    id: string,
    kind?: 'credentials' | 'code',
    submit?: (row: LoginRequest) => Promise<string | void>,
  ) {
    return this.database.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(loginRequests)
        .where(eq(loginRequests.id, id))
        .for('update');
      if (!row)
        throw new ApplicationError(
          'not_found',
          'Secure entry request not found',
        );
      if (kind && row.kind !== kind)
        throw new ApplicationError(
          'invalid_input',
          'Secure entry request has a different input type',
        );
      if (
        !active.includes(row.status as (typeof active)[number]) ||
        (submit && row.status !== 'pending')
      )
        return row;
      if (
        submit &&
        Date.now() - row.createdAt.getTime() >
          (row.kind === 'code' ? 10 * 60_000 : 24 * 3600_000)
      )
        throw new StaleSecureFieldsError();
      const accountId = submit ? await submit(row) : undefined;
      const [updated] = await tx
        .update(loginRequests)
        .set({
          status: submit
            ? row.kind === 'code'
              ? 'filled'
              : 'saved'
            : 'cancelled',
          accountId: accountId ?? null,
          notifiedAt: null,
        })
        .where(eq(loginRequests.id, id))
        .returning();
      return updated;
    });
  }
  async recover(id: string, retry = false) {
    return this.database.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(loginRequests)
        .where(eq(loginRequests.id, id))
        .for('update');
      if (!row)
        throw new ApplicationError(
          'not_found',
          'Secure entry request not found',
        );
      if (retry && row.status === 'pending')
        throw new ApplicationError(
          'conflict',
          'Secure entry is awaiting input',
        );
      if (retry ? row.status !== 'failed' : row.status !== 'pending')
        return row;
      const attempts = retry ? 0 : row.recoveryAttempts;
      const status = attempts < 2 ? 'updating' : 'failed';
      const [updated] = await tx
        .update(loginRequests)
        .set({
          status,
          recoveryAttempts: attempts + (status === 'updating' ? 1 : 0),
          recoveryAt: status === 'updating' ? new Date() : null,
          notifiedAt: null,
        })
        .where(eq(loginRequests.id, id))
        .returning();
      return updated;
    });
  }
  async notifications() {
    return this.database.db
      .select()
      .from(loginRequests)
      .where(
        and(
          ne(loginRequests.status, 'pending'),
          isNull(loginRequests.notifiedAt),
        ),
      )
      .limit(10);
  }
  async cleanup() {
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    await this.database.db
      .delete(loginInspections)
      .where(lt(loginInspections.createdAt, cutoff));
    const expired = await this.database.db
      .update(loginRequests)
      .set({ status: 'cancelled', notifiedAt: null })
      .where(
        and(
          eq(loginRequests.status, 'pending'),
          eq(loginRequests.kind, 'credentials'),
          lt(loginRequests.createdAt, cutoff),
        ),
      )
      .returning();
    const timedOut = await this.database.db
      .update(loginRequests)
      .set({ status: 'failed', notifiedAt: null })
      .where(
        and(
          eq(loginRequests.status, 'updating'),
          lt(loginRequests.recoveryAt, new Date(Date.now() - 120_000)),
        ),
      )
      .returning();
    return [...expired, ...timedOut];
  }
  async notified(id: string, status: LoginRequest['status']) {
    await this.database.db
      .update(loginRequests)
      .set({ notifiedAt: new Date() })
      .where(and(eq(loginRequests.id, id), eq(loginRequests.status, status)));
  }
}
