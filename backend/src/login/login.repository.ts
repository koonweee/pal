import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, gt, ne, isNull, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { loginInspections, loginRequests } from '../database/schema.js';
import { ApplicationError } from '../application/contracts/errors.js';
import type { LoginTarget } from './login-browser.js';

@Injectable()
export class LoginRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async request(
    taskId: string,
    origin: string,
    kind: 'credentials' | 'code' = 'credentials',
    targetRef?: string,
    workerId?: string,
  ): Promise<typeof loginRequests.$inferSelect> {
    await this.cleanup();
    const [created] = await this.database.db
      .insert(loginRequests)
      .values({ taskId, origin, kind, targetRef, workerId })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [existing] = await this.database.db
      .select()
      .from(loginRequests)
      .where(
        and(
          eq(loginRequests.taskId, taskId),
          eq(loginRequests.origin, origin),
          eq(loginRequests.status, 'pending'),
          eq(loginRequests.kind, kind),
        ),
      );
    // A changed target gets a new request ID so an in-progress user draft
    // cannot silently move to another verification form.
    if (kind === 'code' && existing.targetRef !== targetRef) {
      await this.database.db
        .update(loginRequests)
        .set({ status: 'cancelled', notifiedAt: new Date() })
        .where(
          and(
            eq(loginRequests.id, existing.id),
            eq(loginRequests.status, 'pending'),
          ),
        );
      return this.request(taskId, origin, kind, targetRef, workerId);
    }
    return existing;
  }
  async inspection(
    taskId: string,
    origin: string,
    targets: LoginTarget[],
    image: Buffer,
  ) {
    const [row] = await this.database.db
      .insert(loginInspections)
      .values({ taskId, origin, targets, image: image.toString('base64') })
      .returning({ id: loginInspections.id });
    await this.cleanup();
    return row.id;
  }
  async snapshot(taskId: string) {
    await this.cleanup();
    const requests = await this.database.db
      .select({
        id: loginRequests.id,
        origin: loginRequests.origin,
        status: loginRequests.status,
        kind: loginRequests.kind,
      })
      .from(loginRequests)
      .where(eq(loginRequests.taskId, taskId))
      .orderBy(desc(loginRequests.createdAt))
      .limit(10);
    const inspections = await this.database.db
      .select({
        id: loginInspections.id,
        origin: loginInspections.origin,
        targets: loginInspections.targets,
      })
      .from(loginInspections)
      .where(
        and(
          eq(loginInspections.taskId, taskId),
          gt(loginInspections.createdAt, new Date(Date.now() - 24 * 3600_000)),
        ),
      )
      .orderBy(desc(loginInspections.createdAt))
      .limit(1);
    return { requests, inspections };
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
    submit?: (row: typeof loginRequests.$inferSelect) => Promise<string | void>,
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
          'conflict',
          'Secure entry request has a different input type',
        );
      if (row.status !== 'pending') return row;
      const lifetime = row.kind === 'code' ? 10 * 60_000 : 24 * 3600_000;
      if (submit && Date.now() - row.createdAt.getTime() > lifetime)
        throw new ApplicationError(
          'conflict',
          'Secure entry request expired; inspect again',
        );
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
    await this.database.db
      .update(loginRequests)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(loginRequests.status, 'pending'),
          or(
            lt(loginRequests.createdAt, cutoff),
            and(
              eq(loginRequests.kind, 'code'),
              lt(loginRequests.createdAt, new Date(Date.now() - 10 * 60_000)),
            ),
          ),
        ),
      );
  }
  async notified(id: string) {
    await this.database.db
      .update(loginRequests)
      .set({ notifiedAt: new Date() })
      .where(eq(loginRequests.id, id));
  }
}
