import { Module } from '@nestjs/common';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export type Database = NodePgDatabase;

/** Что `db.transaction()` передаёт в колбэк */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Репозиторий выполняет запросы на пуле или внутри транзакции */
export type DatabaseExecutor = Database | Transaction;

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        drizzle,
        connection: config.DATABASE_URL,
      }),
    }),
  ],
})
export class DatabaseModule {}
