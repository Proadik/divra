import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Пользователь. Входит кошельком, поэтому ни пароля, ни email: личность — это ключ.
 * Персональных данных сверх необходимого не храним.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: varchar('display_name', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
});

/**
 * Кошельки пользователя. Отдельная таблица: у одного человека может быть
 * несколько кошельков и сетей (ETH/TON/TRON позже), а адрес принадлежит ровно одному.
 */
export const walletAccounts = pgTable(
  'wallet_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chain: varchar('chain', { length: 16 }).notNull(),
    /** Base58 у Solana — регистр значим, не нормализуем */
    address: varchar('address', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('wallet_accounts_chain_address_uq').on(
      table.chain,
      table.address,
    ),
    index('wallet_accounts_user_idx').on(table.userId),
    check(
      'wallet_accounts_chain_ck',
      sql`${table.chain} in ('solana', 'ethereum', 'ton', 'tron')`,
    ),
  ],
);
