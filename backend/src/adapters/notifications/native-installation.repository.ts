import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, ne, sql } from 'drizzle-orm';
import { ApplicationError } from '../../application/contracts/errors.js';
import { DatabaseService } from '../../database/database.service.js';
import { nativeInstallations } from '../../database/notification.schema.js';

export type NativeInstallation = typeof nativeInstallations.$inferSelect;

@Injectable()
export class NativeInstallationRepository {
  private readonly environment?: 'development' | 'production';

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.environment = config.get<'development' | 'production'>(
      'PAL_APNS_ENVIRONMENT',
    );
  }

  async register(input: {
    id: string;
    token: string;
    environment: 'development' | 'production';
  }) {
    if (!this.environment)
      throw new ApplicationError(
        'unavailable',
        'Notifications are unavailable',
      );
    if (input.environment !== this.environment)
      throw new ApplicationError(
        'invalid_input',
        'Notification environment does not match the server',
      );
    const token = input.token.toLowerCase();
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('native:ios'))`,
      );
      const [existing] = await tx
        .select()
        .from(nativeInstallations)
        .where(eq(nativeInstallations.id, input.id));
      const changed =
        !existing ||
        existing.token !== token ||
        existing.environment !== input.environment;
      await tx
        .update(nativeInstallations)
        .set({ enabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(nativeInstallations.destinationId, 'ios'),
            ne(nativeInstallations.id, input.id),
            eq(nativeInstallations.enabled, true),
          ),
        );
      const generation = changed
        ? (existing?.generation ?? 0) + 1
        : existing.generation;
      const values = {
        id: input.id,
        destinationId: 'ios',
        provider: 'apns',
        token,
        environment: input.environment,
        generation,
        enabled: true,
        updatedAt: new Date(),
      };
      const [installation] = await tx
        .insert(nativeInstallations)
        .values(values)
        .onConflictDoUpdate({ target: nativeInstallations.id, set: values })
        .returning();
      return installation;
    });
  }

  async disable(id: string) {
    await this.database.db
      .update(nativeInstallations)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(nativeInstallations.id, id));
  }

  async active() {
    const [installation] = await this.database.db
      .select()
      .from(nativeInstallations)
      .where(
        and(
          eq(nativeInstallations.destinationId, 'ios'),
          eq(nativeInstallations.provider, 'apns'),
          eq(nativeInstallations.enabled, true),
        ),
      )
      .limit(1);
    return installation;
  }

  disableIfGeneration(id: string, generation: number) {
    return this.database.db
      .update(nativeInstallations)
      .set({ enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(nativeInstallations.id, id),
          eq(nativeInstallations.generation, generation),
        ),
      );
  }
}
