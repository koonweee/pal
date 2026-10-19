import { Inject, Injectable } from '@nestjs/common';
import { eq, sql, and } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { mcpServers } from '../database/schema.js';
import type { McpAuth } from './mcp.types.js';

@Injectable()
export class McpRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  list() {
    return this.database.db.select().from(mcpServers).orderBy(mcpServers.name);
  }
  async get(id: string) {
    const [row] = await this.database.db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id));
    return row;
  }
  async create(input: {
    name: string;
    url: string;
    enabled: boolean;
    auth: McpAuth;
  }) {
    const [row] = await this.database.db
      .insert(mcpServers)
      .values(input)
      .returning();
    return row;
  }
  async update(
    id: string,
    input: { name: string; url: string; enabled: boolean; auth: McpAuth },
    resetAuth: boolean,
  ) {
    const [row] = await this.database.db
      .update(mcpServers)
      .set({
        ...input,
        version: sql`${mcpServers.version} + 1`,
        updatedAt: new Date(),
        ...(resetAuth
          ? { oauth: {}, authEpoch: sql`${mcpServers.authEpoch} + 1` }
          : {}),
      })
      .where(eq(mcpServers.id, id))
      .returning();
    return row;
  }
  async remove(id: string) {
    await this.database.db.delete(mcpServers).where(eq(mcpServers.id, id));
  }
  async forget(id: string) {
    await this.database.db
      .update(mcpServers)
      .set({
        oauth: {},
        authEpoch: sql`${mcpServers.authEpoch} + 1`,
        version: sql`${mcpServers.version} + 1`,
      })
      .where(eq(mcpServers.id, id));
  }
  async loginChanged(id: string, epoch: number) {
    await this.database.db
      .update(mcpServers)
      .set({ version: sql`${mcpServers.version} + 1` })
      .where(and(eq(mcpServers.id, id), eq(mcpServers.authEpoch, epoch)));
  }
  storage(id: string, epoch: number) {
    // A refresh from a previously configured client must not restore forgotten credentials.
    return {
      get: async (key: string) => {
        const row = await this.get(id);
        return row?.authEpoch === epoch ? row.oauth[key] : undefined;
      },
      set: async (key: string, value: string) => {
        try {
          await this.database.db
            .update(mcpServers)
            .set({
              oauth: sql`jsonb_set(${mcpServers.oauth}, ARRAY[${key}]::text[], ${JSON.stringify(value)}::jsonb)`,
            })
            .where(and(eq(mcpServers.id, id), eq(mcpServers.authEpoch, epoch)));
        } catch {
          // Database errors may contain the credential in SQL parameters.
          throw new Error('MCP credential storage unavailable');
        }
      },
      delete: async (key: string) => {
        await this.database.db
          .update(mcpServers)
          .set({ oauth: sql`${mcpServers.oauth} - ${key}` })
          .where(and(eq(mcpServers.id, id), eq(mcpServers.authEpoch, epoch)));
      },
    };
  }
}
