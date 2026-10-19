import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  DatabaseService,
  type Executor,
  type Transaction,
} from '../database/database.service.js';
import {
  deliveryJobs,
  destinations,
  type DeliveryJobState,
} from '../database/schema.js';

export type DeliveryJob = typeof deliveryJobs.$inferSelect;

@Injectable()
export class DeliveryJobRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async enqueue(
    messageId: string,
    destinationIds: string[],
    notificationDestinationIds: string[],
    tx: Transaction,
    change?: { version: number; reaction: string },
  ) {
    if (!destinationIds.length) return [];
    const notifications = new Set(notificationDestinationIds);
    const configured = await tx
      .select({ id: destinations.id, adapterId: destinations.adapterId })
      .from(destinations)
      .where(inArray(destinations.id, destinationIds));
    return tx
      .insert(deliveryJobs)
      .values(
        configured.map(({ id: destinationId, adapterId }) => ({
          messageId,
          destinationId,
          adapterId,
          notify: notifications.has(destinationId),
          messageVersion: change?.version ?? 1,
          reaction: change?.reaction ?? null,
        })),
      )
      .returning();
  }

  async recoverInterrupted() {
    return this.database.db
      .update(deliveryJobs)
      .set({
        state: 'uncertain',
        errorCode: 'interrupted_send',
        updatedAt: new Date(),
      })
      .where(eq(deliveryJobs.state, 'sending'))
      .returning();
  }

  async cancelDisabled() {
    return this.database.db
      .update(deliveryJobs)
      .set({ state: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          inArray(deliveryJobs.state, ['pending']),
          sql`not exists (select 1 from ${destinations} where ${destinations.id} = ${deliveryJobs.destinationId} and ${destinations.enabled})`,
        ),
      )
      .returning();
  }

  async claim(now = new Date()): Promise<DeliveryJob | undefined> {
    return this.database.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(deliveryJobs)
        .where(
          and(
            eq(deliveryJobs.state, 'pending'),
            lte(deliveryJobs.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(deliveryJobs.nextAttemptAt), asc(deliveryJobs.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!job) return undefined;
      const [claimed] = await tx
        .update(deliveryJobs)
        .set({
          state: 'sending',
          attempts: sql`${deliveryJobs.attempts} + 1`,
          updatedAt: now,
        })
        .where(eq(deliveryJobs.id, job.id))
        .returning();
      return claimed;
    });
  }

  setState(
    id: string,
    state: DeliveryJobState,
    options: { nextAttemptAt?: Date; errorCode?: string | null } = {},
    db: Executor = this.database.db,
  ) {
    return db
      .update(deliveryJobs)
      .set({ state, ...options, updatedAt: new Date() })
      .where(eq(deliveryJobs.id, id));
  }
}
