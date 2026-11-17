import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  // `generate` в базу не ходит — адрес нужен для `migrate` и `studio`
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/divra' },
});
