import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { type Stablecoin, payments } from './payments.schema.js';
import { users } from './users.schema.js';

export const DETECTED_TRANSFER_STATUSES = [
  'pending',
  'applied',
  'dismissed',
] as const;
export type DetectedTransferStatus =
  (typeof DETECTED_TRANSFER_STATUSES)[number];

/**
 * Перевод стейблкоина между участниками общих групп, замеченный в потоке LaserStream, но сделанный
 * мимо Divra (без reference запроса или расчёта). Это только подсказка получателю: долг гасит
 * его «Засчитать», после повторной сверки транзакции в сети.
 */
export const detectedTransfers = pgTable(
  'detected_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    signature: varchar('signature', { length: 88 }).notNull(),
    slot: bigint('slot', { mode: 'number' }).notNull(),
    token: varchar('token', { length: 4 }).$type<Stablecoin>().notNull(),
    mint: varchar('mint', { length: 44 }).notNull(),
    /** Сколько получил получатель, минимальные единицы токена (6 знаков) */
    rawAmount: bigint('raw_amount', { mode: 'bigint' }).notNull(),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUserId: uuid('to_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromAddress: varchar('from_address', { length: 44 }).notNull(),
    toAddress: varchar('to_address', { length: 44 }).notNull(),
    status: varchar('status', { length: 10 })
      .$type<DetectedTransferStatus>()
      .notNull()
      .default('pending'),
    /** Строка payments, которой перевод засчитан */
    paymentId: uuid('payment_id').references(() => payments.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    // Один перевод получателю — одна подсказка, даже если поток прислал его дважды
    uniqueIndex('detected_transfers_signature_to_uq').on(
      table.signature,
      table.toAddress,
    ),
    index('detected_transfers_to_pending_idx')
      .on(table.toUserId, table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    check(
      'detected_transfers_status_ck',
      sql`${table.status} in ('pending', 'applied', 'dismissed')`,
    ),
    check('detected_transfers_amount_ck', sql`${table.rawAmount} > 0`),
    check(
      'detected_transfers_users_ck',
      sql`${table.fromUserId} <> ${table.toUserId}`,
    ),
  ],
);

/** До какого слота поток обработан — с него догоняем после перезапуска */
export const chainStreamState = pgTable('chain_stream_state', {
  name: varchar('name', { length: 32 }).primaryKey(),
  lastSlot: bigint('last_slot', { mode: 'number' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Индекс переводов стейблкоина, затронувших кошельки пользователей Divra, — из потока LaserStream.
 * Источник «Истории»: все переводы, а не только засчитанные в долг. Одна строка — один получатель
 * в транзакции (у расчёта их несколько).
 */
export const chainTransfers = pgTable(
  'chain_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    signature: varchar('signature', { length: 88 }).notNull(),
    slot: bigint('slot', { mode: 'number' }).notNull(),
    token: varchar('token', { length: 4 }).$type<Stablecoin>().notNull(),
    mint: varchar('mint', { length: 44 }).notNull(),
    /** Сколько получил получатель, минимальные единицы (6 знаков) */
    rawAmount: bigint('raw_amount', { mode: 'bigint' }).notNull(),
    fromAddress: varchar('from_address', { length: 44 }).notNull(),
    toAddress: varchar('to_address', { length: 44 }).notNull(),
    /** Пользователь Divra на стороне отправителя / получателя; null — чужой кошелёк */
    fromUserId: uuid('from_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    toUserId: uuid('to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Повтор транзакции из потока (переподключение, replay) ничего не дублирует
    uniqueIndex('chain_transfers_signature_to_uq').on(
      table.signature,
      table.toAddress,
      table.mint,
    ),
    index('chain_transfers_from_user_idx').on(
      table.fromUserId,
      table.createdAt,
    ),
    index('chain_transfers_to_user_idx').on(table.toUserId, table.createdAt),
    index('chain_transfers_signature_idx').on(table.signature),
    // Без CHECK «хотя бы один пользователь»: при удалении аккаунта обе стороны могут стать null
    check('chain_transfers_amount_ck', sql`${table.rawAmount} > 0`),
  ],
);
