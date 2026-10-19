import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import {
  adapterState,
  externalMessageReferences,
  secondaryInputs,
} from '../../database/secondary.schema.js';
import type { ExternalReference } from './secondary-driver.js';

@Injectable()
export class SecondaryRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async input(
    adapterId: string,
    destinationId: string,
    externalEventId: string,
  ) {
    const [row] = await this.database.db
      .select()
      .from(secondaryInputs)
      .where(
        and(
          eq(secondaryInputs.adapterId, adapterId),
          eq(secondaryInputs.destinationId, destinationId),
          eq(secondaryInputs.externalEventId, externalEventId),
        ),
      );
    return row;
  }

  async recordInput(input: {
    adapterId: string;
    destinationId: string;
    externalEventId: string;
    externalMessageId: string;
    externalThreadId?: string;
    canonicalMessageId: string;
  }) {
    await this.database.transaction(async (tx) => {
      await tx.insert(secondaryInputs).values(input).onConflictDoNothing();
      await tx
        .insert(externalMessageReferences)
        .values({
          adapterId: input.adapterId,
          destinationId: input.destinationId,
          externalMessageId: input.externalMessageId,
          externalThreadId: input.externalThreadId,
          canonicalMessageId: input.canonicalMessageId,
          direction: 'incoming',
          position: 0,
        })
        .onConflictDoNothing();
    });
  }

  async byExternal(
    adapterId: string,
    destinationId: string,
    externalMessageId: string,
  ) {
    const [row] = await this.database.db
      .select()
      .from(externalMessageReferences)
      .where(
        and(
          eq(externalMessageReferences.adapterId, adapterId),
          eq(externalMessageReferences.destinationId, destinationId),
          eq(externalMessageReferences.externalMessageId, externalMessageId),
        ),
      );
    return row;
  }

  async referencesFor(
    adapterId: string,
    destinationId: string,
    canonicalMessageId: string,
  ) {
    return this.database.db
      .select()
      .from(externalMessageReferences)
      .where(
        and(
          eq(externalMessageReferences.adapterId, adapterId),
          eq(externalMessageReferences.destinationId, destinationId),
          eq(externalMessageReferences.canonicalMessageId, canonicalMessageId),
        ),
      )
      .orderBy(externalMessageReferences.position);
  }

  async recordOutgoingReferences(
    adapterId: string,
    destinationId: string,
    canonicalMessageId: string,
    references: ExternalReference[],
  ) {
    if (!references.length) return;
    await this.database.db
      .insert(externalMessageReferences)
      .values(
        references.map((reference) => ({
          adapterId,
          destinationId,
          canonicalMessageId,
          direction: 'outgoing' as const,
          ...reference,
        })),
      )
      .onConflictDoNothing();
  }

  async state(adapterId: string, destinationId: string, key: string) {
    const [row] = await this.database.db
      .select({ value: adapterState.value })
      .from(adapterState)
      .where(
        and(
          eq(adapterState.adapterId, adapterId),
          eq(adapterState.destinationId, destinationId),
          eq(adapterState.key, key),
        ),
      );
    return row?.value;
  }

  async setState(
    adapterId: string,
    destinationId: string,
    key: string,
    value: Record<string, unknown>,
  ) {
    await this.database.db
      .insert(adapterState)
      .values({ adapterId, destinationId, key, value })
      .onConflictDoUpdate({
        target: [
          adapterState.adapterId,
          adapterState.destinationId,
          adapterState.key,
        ],
        set: { value, updatedAt: new Date() },
      });
  }
}
