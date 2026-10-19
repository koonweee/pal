import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/database/schema.ts',
    './src/database/secondary.schema.ts',
    './src/database/notification.schema.ts',
  ],
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL },
});
