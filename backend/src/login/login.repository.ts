import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, gt, ne, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { loginInspections, loginRequests } from '../database/schema.js';
import { ApplicationError } from '../application/contracts/errors.js';
import type { LoginTarget } from './login-browser.js';
import type { CredentialInput } from './bitwarden.service.js';

@Injectable()
export class LoginRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async request(taskId: string, origin: string) {
    await this.cleanup();
    const [created] = await this.database.db
      .insert(loginRequests)
      .values({ taskId, origin })
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
        ),
      );
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
      .limit(3);
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
    input: CredentialInput | undefined,
    save: (
      origin: string,
      input: CredentialInput,
      id: string,
    ) => Promise<string>,
  ) {
    return this.database.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(loginRequests)
        .where(eq(loginRequests.id, id))
        .for('update');
      if (!row)
        throw new ApplicationError('not_found', 'Login request not found');
      if (row.status !== 'pending') return row;
      if (input && Date.now() - row.createdAt.getTime() > 24 * 3600_000)
        throw new ApplicationError('conflict', 'Login request expired');
      const accountId = input ? await save(row.origin, input, row.id) : null;
      const [updated] = await tx
        .update(loginRequests)
        .set({ status: input ? 'saved' : 'cancelled', accountId })
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
          lt(loginRequests.createdAt, cutoff),
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
