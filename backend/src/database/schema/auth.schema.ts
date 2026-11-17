import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Вызовы на подпись: одноразовые, живут минуты. Храним хэш скомпилированного
 * сообщения транзакции — подпись проверяется ровно под тем, что выдали.
 */
export const authChallenges = pgTable(
  'auth_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chain: varchar('chain', { length: 16 }).notNull(),
    address: varchar('address', { length: 64 }).notNull(),
    /** Текст memo — для проверки, если кошелёк добавил к транзакции служебные инструкции */
    message: text('message').notNull(),
    /** SHA-256 сообщения транзакции (hex) */
    messageHash: varchar('message_hash', { length: 64 }).notNull(),
    blockhash: varchar('blockhash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [
    index('auth_challenges_address_idx').on(table.chain, table.address),
    index('auth_challenges_expires_idx').on(table.expiresAt),
  ],
);

/**
 * Refresh-токены @nestjs/authentication. Сам токен не храним — только SHA-256 (id).
 * Ротация: каждый токен одноразовый, все потомки одного входа — одно семейство.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    familyId: varchar('family_id', { length: 128 }).notNull(),
    /**
     * Без внешнего ключа: контракт @nestjs/authentication не привязан к таблице users.
     * При удалении пользователя его семейства отзываются через TokenService.revokeAll().
     */
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    familyExpiresAt: timestamp('family_expires_at', {
      withTimezone: true,
    }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    claims: jsonb('claims').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('refresh_tokens_family_idx').on(table.familyId),
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_family_expires_idx').on(table.familyExpiresAt),
  ],
);

/**
 * Отозванные семейства. Отдельно от токенов: отзыв должен действовать и на токены
 * семейства, сохранённые позже (гонка refresh против повторного использования).
 */
export const refreshTokenFamilyRevocations = pgTable(
  'refresh_token_family_revocations',
  {
    familyId: varchar('family_id', { length: 128 }).primaryKey(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('refresh_token_family_revocations_at_idx').on(table.revokedAt),
  ],
);
