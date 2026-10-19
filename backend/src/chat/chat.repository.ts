import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  DatabaseService,
  type Executor,
  type Transaction,
} from '../database/database.service.js';
import {
  messages,
  messageAttachments,
  attachments,
} from '../database/schema.js';
import { attachmentView } from '../files/files.repository.js';
import type { UserVisibleMessage } from './chat.types.js';
export type MessageRecord = typeof messages.$inferSelect;
@Injectable()
export class ChatRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async get(id: string, db: Executor = this.database.db) {
    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    return row;
  }
  async getBySequence(sequence: number, db: Executor = this.database.db) {
    const [row] = await db
      .select()
      .from(messages)
      .where(eq(messages.sequence, sequence));
    return row;
  }
  async lock(id: string, tx: Transaction) {
    const [row] = await tx
      .select()
      .from(messages)
      .where(eq(messages.id, id))
      .for('update');
    return row;
  }
  async create(input: typeof messages.$inferInsert, tx: Transaction) {
    const [row] = await tx.insert(messages).values(input).returning();
    return row;
  }
  async update(
    id: string,
    input: Partial<Pick<MessageRecord, 'text' | 'actions' | 'reaction'>>,
    tx: Transaction,
  ) {
    const [row] = await tx
      .update(messages)
      .set({
        ...input,
        version: sql`${messages.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, id))
      .returning();
    return row;
  }
  list(
    options: { taskId?: string; before?: number; limit: number },
    db: Executor,
  ) {
    return db
      .select()
      .from(messages)
      .where(
        and(
          options.taskId
            ? eq(messages.taskId, options.taskId)
            : sql`(${messages.taskId} is null or ${messages.mainVisible})`,
          options.before
            ? sql`${messages.sequence} < ${options.before}`
            : undefined,
        ),
      )
      .orderBy(desc(messages.sequence))
      .limit(options.limit + 1);
  }
  async views(
    rows: MessageRecord[],
    db: Executor,
  ): Promise<UserVisibleMessage[]> {
    if (!rows.length) return [];
    const links = await db
      .select({
        messageId: messageAttachments.messageId,
        attachment: attachments,
      })
      .from(messageAttachments)
      .innerJoin(
        attachments,
        eq(attachments.id, messageAttachments.attachmentId),
      )
      .where(
        inArray(
          messageAttachments.messageId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(messageAttachments.position);
    const replyIds = [
      ...new Set(
        rows
          .map((row) => row.replyToMessageId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const replies = replyIds.length
      ? await db.select().from(messages).where(inArray(messages.id, replyIds))
      : [];
    const repliesById = new Map(replies.map((row) => [row.id, row]));
    return rows.map((row) => {
      const target = row.replyToMessageId
        ? repliesById.get(row.replyToMessageId)
        : undefined;
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        version: row.version,
        sequence: row.sequence,
        idempotencyKey: row.idempotencyKey,
        replyToMessageId: row.replyToMessageId,
        replyTo: target
          ? {
              id: target.id,
              sequence: target.sequence,
              role: target.role,
              textPreview: target.text.slice(0, 160),
              taskId: target.taskId,
              phase: target.phase,
              mainVisible: target.mainVisible,
            }
          : null,
        role: row.role,
        text: row.text,
        metadata: row.metadata,
        source: row.source,
        originDestinationId: row.originDestinationId,
        mainVisible: row.mainVisible,
        reaction: row.reaction,
        deliveryDestinationIds: row.deliveryDestinationIds,
        notificationDestinationIds: row.notificationDestinationIds,
        notify: row.notificationDestinationIds.length > 0,
        taskId: row.taskId,
        phase: row.phase,
        actions: row.actions,
        attachments: links
          .filter((link) => link.messageId === row.id)
          .map((link) => attachmentView(link.attachment)),
      };
    });
  }
}
