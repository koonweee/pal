import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import {
  DatabaseService,
  type Transaction,
} from '../../database/database.service.js';
import { notificationIntents } from '../../database/schema.js';
import {
  webPushDeliveries,
  webPushInstallations,
} from '../../database/notification.schema.js';
import type { NotificationIntent } from '../../notifications/notification.repository.js';

export type WebPushInstallation = typeof webPushInstallations.$inferSelect;
export type WebPushDelivery = typeof webPushDeliveries.$inferSelect;

@Injectable()
export class WebPushRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  register(input: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }) {
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.endpoint}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(webPushInstallations)
        .where(eq(webPushInstallations.endpoint, input.endpoint));
      if (
        existing?.enabled &&
        existing.p256dh === input.keys.p256dh &&
        existing.auth === input.keys.auth
      )
        return existing;
      const values = {
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        enabled: true,
        generation: (existing?.generation ?? 0) + 1,
        activatedAt: new Date(),
        updatedAt: new Date(),
      };
      const [row] = await tx
        .insert(webPushInstallations)
        .values(values)
        .onConflictDoUpdate({
          target: webPushInstallations.endpoint,
          set: values,
        })
        .returning();
      return row;
    });
  }

  disable(id: string, generation?: number) {
    return this.database.db
      .update(webPushInstallations)
      .set({ enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(webPushInstallations.id, id),
          generation === undefined
            ? undefined
            : eq(webPushInstallations.generation, generation),
        ),
      );
  }

  async materialize(intent: NotificationIntent, tx: Transaction) {
    const installations = await tx
      .select()
      .from(webPushInstallations)
      .where(
        and(
          eq(webPushInstallations.enabled, true),
          lte(webPushInstallations.activatedAt, intent.createdAt),
        ),
      );
    if (!installations.length) return false;
    await tx
      .insert(webPushDeliveries)
      .values(
        installations.map((installation) => ({
          intentId: intent.id,
          installationId: installation.id,
          generation: installation.generation,
        })),
      )
      .onConflictDoNothing();
    return true;
  }

  recoverInterrupted() {
    return this.database.db
      .update(webPushDeliveries)
      .set({
        state: 'uncertain',
        errorCode: 'interrupted_send',
        updatedAt: new Date(),
      })
      .where(eq(webPushDeliveries.state, 'sending'));
  }

  async claim(now = new Date()) {
    return this.database.transaction(async (tx) => {
      const [row] = await tx
        .select({ delivery: webPushDeliveries, intent: notificationIntents })
        .from(webPushDeliveries)
        .innerJoin(
          notificationIntents,
          eq(notificationIntents.id, webPushDeliveries.intentId),
        )
        .where(
          and(
            eq(webPushDeliveries.state, 'pending'),
            lte(webPushDeliveries.nextAttemptAt, now),
          ),
        )
        .orderBy(
          asc(webPushDeliveries.nextAttemptAt),
          asc(webPushDeliveries.createdAt),
        )
        .limit(1)
        .for('update', { of: webPushDeliveries, skipLocked: true });
      if (!row) return undefined;
      const [delivery] = await tx
        .update(webPushDeliveries)
        .set({
          state: 'sending',
          attempts: sql`${webPushDeliveries.attempts} + 1`,
          updatedAt: now,
        })
        .where(eq(webPushDeliveries.id, row.delivery.id))
        .returning();
      const [installation] = await tx
        .select()
        .from(webPushInstallations)
        .where(eq(webPushInstallations.id, delivery.installationId));
      return { delivery, intent: row.intent, installation };
    });
  }

  settle(
    id: string,
    state: WebPushDelivery['state'],
    options: {
      errorCode?: string | null;
      nextAttemptAt?: Date;
    } = {},
  ) {
    return this.database.db
      .update(webPushDeliveries)
      .set({
        state,
        errorCode: null,
        ...options,
        updatedAt: new Date(),
      })
      .where(eq(webPushDeliveries.id, id));
  }
}
