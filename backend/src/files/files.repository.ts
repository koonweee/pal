import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../application/contracts/errors.js';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  DatabaseService,
  type Executor,
  type Transaction,
} from '../database/database.service.js';
import {
  attachments,
  messageAttachments,
  instanceSettings,
} from '../database/schema.js';
import type { Attachment } from './files.types.js';
export type AttachmentRecord = typeof attachments.$inferSelect;
export function attachmentView(row: AttachmentRecord): Attachment {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  };
}
@Injectable()
export class FilesRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async get(id: string, db: Executor = this.database.db) {
    const [row] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, id));
    return row;
  }
  async getMany(ids: string[]) {
    if (!ids.length) return [];
    return this.database.db
      .select()
      .from(attachments)
      .where(inArray(attachments.id, ids));
  }
  async create(input: typeof attachments.$inferInsert) {
    const [row] = await this.database.db
      .insert(attachments)
      .values(input)
      .returning();
    return row;
  }
  async lock(ids: string[], tx: Transaction) {
    if (!ids.length) return;
    if (new Set(ids).size !== ids.length)
      throw new ApplicationError(
        'invalid_input',
        'Attachment IDs must be unique',
      );
    const rows = await tx
      .select({ id: attachments.id })
      .from(attachments)
      .where(inArray(attachments.id, ids))
      .orderBy(asc(attachments.id))
      .for('update');
    if (rows.length !== ids.length)
      throw new ApplicationError(
        'invalid_input',
        'One or more attachments do not exist',
      );
  }
  async attachToMessage(messageId: string, ids: string[], tx: Transaction) {
    await this.lock(ids, tx);
    if (ids.length)
      await tx.insert(messageAttachments).values(
        ids.map((attachmentId, position) => ({
          messageId,
          attachmentId,
          position,
        })),
      );
  }
  async removeExpired(cutoff: Date) {
    return this.database.transaction(async (tx) => {
      await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(sql`${attachments.createdAt} < ${cutoff}`)
        .orderBy(asc(attachments.id))
        .for('update');
      return tx
        .delete(attachments)
        .where(
          and(
            sql`${attachments.createdAt} < ${cutoff}`,
            sql`not exists (select 1 from ${messageAttachments} where ${messageAttachments.attachmentId} = ${attachments.id})`,
            sql`not exists (select 1 from ${instanceSettings} where ${instanceSettings.agentAvatarAttachmentId} = ${attachments.id})`,
          ),
        )
        .returning();
    });
  }
  async storageNames() {
    const rows = await this.database.db
      .select({ name: attachments.storageFilename })
      .from(attachments);
    return new Set(rows.map((r) => r.name));
  }
}
