import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { instanceSettings } from '../database/schema.js';
import { FilesRepository } from '../files/files.repository.js';
import {
  DEFAULT_INSTANCE_SETTINGS,
  type InstanceSettings,
  type UpdateInstanceSettings,
} from './instance-settings.types.js';

@Injectable()
export class InstanceSettingsRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(FilesRepository) private readonly files: FilesRepository,
  ) {}

  async get(): Promise<InstanceSettings> {
    const [row] = await this.database.db.select().from(instanceSettings);
    return row ? this.view(row) : { ...DEFAULT_INSTANCE_SETTINGS };
  }

  async update(input: UpdateInstanceSettings): Promise<InstanceSettings> {
    return this.database.transaction(async (tx) => {
      // Cleanup takes the same attachment lock before checking live references.
      if (input.agentAvatarAttachmentId)
        await this.files.lock([input.agentAvatarAttachmentId], tx);
      const [row] = await tx
        .insert(instanceSettings)
        .values({ id: 1, ...input })
        .onConflictDoUpdate({
          target: instanceSettings.id,
          set: {
            ...input,
            version: sql`${instanceSettings.version} + 1`,
          },
        })
        .returning();
      return this.view(row);
    });
  }

  private view(row: typeof instanceSettings.$inferSelect): InstanceSettings {
    const { id: _id, ...settings } = row;
    return settings;
  }
}
