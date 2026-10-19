import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: resolve(process.cwd(), 'migrations'),
  });
} finally {
  await pool.end();
}
