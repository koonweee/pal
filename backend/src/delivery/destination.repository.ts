import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DatabaseService,
  type Executor,
} from '../database/database.service.js';
import { destinations } from '../database/schema.js';

@Injectable()
export class DestinationRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  list(db: Executor = this.database.db) {
    return db.select().from(destinations).orderBy(destinations.id);
  }

  async get(id: string, db: Executor = this.database.db) {
    const [row] = await db
      .select()
      .from(destinations)
      .where(eq(destinations.id, id));
    return row;
  }

  async setEnabled(id: string, enabled: boolean) {
    const [row] = await this.database.db
      .update(destinations)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(destinations.id, id))
      .returning();
    return row;
  }
}
