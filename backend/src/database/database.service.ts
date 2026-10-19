import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ApplicationError } from '../application/contracts/errors.js';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as coreSchema from './schema.js';
import * as secondarySchema from './secondary.schema.js';
import * as notificationSchema from './notification.schema.js';
const databaseSchema = {
  ...coreSchema,
  ...secondarySchema,
  ...notificationSchema,
};
export type Database = NodePgDatabase<typeof databaseSchema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  readonly pool: Pool;
  readonly db: Database;
  constructor(@Inject(ConfigService) config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: 10,
    });
    this.db = drizzle(this.pool, { schema: databaseSchema });
  }
  async onModuleInit() {
    await this.pool.query('select 1');
  }
  async onApplicationShutdown() {
    await this.pool.end();
  }
  transaction<T>(operation: (tx: Transaction) => Promise<T>) {
    return this.db.transaction(operation);
  }

  async idempotent(
    operation: string,
    key: string,
    request: Record<string, unknown>,
    work: (tx: Transaction) => Promise<{ messageId: string }>,
  ) {
    return this.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${operation + ':' + key}, 0))`,
      );
      const [existing] = await tx
        .select({
          response: coreSchema.idempotency.response,
          matches: sql<boolean>`${coreSchema.idempotency.request} = ${JSON.stringify(request)}::jsonb`,
        })
        .from(coreSchema.idempotency)
        .where(
          and(
            eq(coreSchema.idempotency.operation, operation),
            eq(coreSchema.idempotency.key, key),
          ),
        );
      if (existing) {
        if (!existing.matches)
          throw new ApplicationError(
            'conflict',
            'Idempotency key already used with different input',
          );
        return { ...existing.response, created: false };
      }
      const response = await work(tx);
      await tx
        .insert(coreSchema.idempotency)
        .values({ operation, key, request, response });
      return { ...response, created: true };
    });
  }
}
