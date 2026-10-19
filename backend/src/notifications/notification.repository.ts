import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  DatabaseService,
  type Executor,
  type Transaction,
} from '../database/database.service.js';
import {
  notificationIntents,
  type NotificationIntentState,
} from '../database/schema.js';

export type NotificationIntent = typeof notificationIntents.$inferSelect;

@Injectable()
export class NotificationRepository {
  private readonly configured: Set<string>;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.configured = new Set(
      config.get<string[]>('PAL_NOTIFICATION_DESTINATIONS') ?? [],
    );
  }

  enqueue(
    messageId: string,
    destinationIds: string[],
    tx: Transaction,
    change?: { version: number; reaction: string },
  ) {
    const eligible = [...new Set(destinationIds)].filter((id) =>
      this.configured.has(id),
    );
    if (!eligible.length) return Promise.resolve([]);
    return tx
      .insert(notificationIntents)
      .values(
        eligible.map((destinationId) => ({
          messageId,
          destinationId,
          expiresAt: new Date(
            Date.now() + (destinationId === 'web' ? 300_000 : 86_400_000),
          ),
          messageVersion: change?.version ?? 1,
          reaction: change?.reaction ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning();
  }

  /** Materializes audience targets and settles fanout in the same transaction. */
  async expand(
    destinationId: string,
    materialize: (
      intent: NotificationIntent,
      tx: Transaction,
    ) => Promise<boolean>,
  ) {
    return this.database.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(notificationIntents)
        .where(
          and(
            eq(notificationIntents.destinationId, destinationId),
            eq(notificationIntents.state, 'pending'),
          ),
        )
        .orderBy(asc(notificationIntents.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!intent) return false;
      if (intent.expiresAt.getTime() <= Date.now()) {
        await this.setState(
          intent.id,
          'cancelled',
          { errorCode: 'expired' },
          tx,
        );
      } else {
        const populated = await materialize(intent, tx);
        await this.setState(
          intent.id,
          populated ? 'expanded' : 'cancelled',
          { errorCode: populated ? null : 'no_active_installation' },
          tx,
        );
      }
      return true;
    });
  }

  async recoverInterrupted(destinationId: string) {
    return this.database.db
      .update(notificationIntents)
      .set({
        state: 'uncertain',
        errorCode: 'interrupted_send',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationIntents.destinationId, destinationId),
          eq(notificationIntents.state, 'sending'),
        ),
      )
      .returning();
  }

  async claim(destinationId: string, now = new Date()) {
    return this.database.transaction(async (tx) => {
      await tx
        .update(notificationIntents)
        .set({
          state: 'cancelled',
          errorCode: 'expired',
          updatedAt: now,
        })
        .where(
          and(
            eq(notificationIntents.destinationId, destinationId),
            eq(notificationIntents.state, 'pending'),
            lte(notificationIntents.expiresAt, now),
          ),
        );
      const [intent] = await tx
        .select()
        .from(notificationIntents)
        .where(
          and(
            eq(notificationIntents.destinationId, destinationId),
            eq(notificationIntents.state, 'pending'),
            lte(notificationIntents.nextAttemptAt, now),
          ),
        )
        .orderBy(
          asc(notificationIntents.nextAttemptAt),
          asc(notificationIntents.createdAt),
        )
        .limit(1)
        .for('update', { skipLocked: true });
      if (!intent) return undefined;
      const [claimed] = await tx
        .update(notificationIntents)
        .set({
          state: 'sending',
          attempts: sql`${notificationIntents.attempts} + 1`,
          updatedAt: now,
        })
        .where(eq(notificationIntents.id, intent.id))
        .returning();
      return claimed;
    });
  }

  setState(
    id: string,
    state: NotificationIntentState,
    options: { nextAttemptAt?: Date; errorCode?: string | null } = {},
    db: Executor = this.database.db,
  ) {
    return db
      .update(notificationIntents)
      .set({ state, ...options, updatedAt: new Date() })
      .where(eq(notificationIntents.id, id));
  }

  list(messageIds: string[]) {
    if (!messageIds.length) return Promise.resolve([]);
    return this.database.db
      .select()
      .from(notificationIntents)
      .where(inArray(notificationIntents.messageId, messageIds));
  }
}
