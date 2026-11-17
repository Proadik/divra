import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { groupMembers, groups } from './groups.schema.js';
import { users } from './users.schema.js';

/**
 * Приглашение в группу. Код — 128 случайных бит: по нему страницу открывают без входа.
 * Общее (claim_member_id = null) работает для любого числа людей до expires_at.
 * Персональное «отдаёт» участника без кошелька тому, кто вошёл по ссылке, — один раз.
 */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 32 }).notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Кто пригласил — имя на странице приглашения */
    inviterMemberId: uuid('inviter_member_id').notNull(),
    claimMemberId: uuid('claim_member_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Сколько человек вошли по ссылке */
    uses: integer('uses').notNull().default(0),
    /** Персональное: когда участника забрали. После этого ссылка не работает */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('invites_code_uq').on(table.code),
    foreignKey({
      name: 'invites_inviter_fk',
      columns: [table.groupId, table.inviterMemberId],
      foreignColumns: [groupMembers.groupId, groupMembers.id],
    }),
    foreignKey({
      name: 'invites_claim_fk',
      columns: [table.groupId, table.claimMemberId],
      foreignColumns: [groupMembers.groupId, groupMembers.id],
    }),
    index('invites_group_idx').on(table.groupId),
    index('invites_claim_idx')
      .on(table.claimMemberId)
      .where(sql`${table.claimMemberId} is not null`),
  ],
);
