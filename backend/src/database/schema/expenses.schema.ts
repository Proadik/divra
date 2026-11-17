import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { groupMembers, groups } from './groups.schema.js';
import { users } from './users.schema.js';

export const EXPENSE_CATEGORIES = [
  'transport',
  'housing',
  'food',
  'groceries',
  'fun',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const SPLIT_MODES = ['equal', 'exact', 'percent', 'shares'] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

/** Валюты ввода. Расчёт всегда в долларах (стейблкоин 1:1) */
export const FIAT_CURRENCIES = ['KZT', 'RUB', 'CNY', 'EUR', 'USD'] as const;
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

/**
 * Расход. Сумма — в центах доллара (целое число: никаких 0.1 + 0.2).
 * Плательщик — участник этой же группы: составной ключ (group_id, paid_by_member_id)
 * не даст сослаться на участника другой группы даже при ошибке в коде.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 60 }).notNull(),
    category: varchar('category', { length: 16 })
      .$type<ExpenseCategory>()
      .notNull(),
    paidByMemberId: uuid('paid_by_member_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    /** Как делили — форма редактирования покажет исходный ввод */
    splitMode: varchar('split_mode', { length: 8 })
      .$type<SplitMode>()
      .notNull(),
    /** Как ввели: сумма в валюте ввода и курс (единиц за 1 USD). Ввели в долларах — все null */
    originalCurrency: varchar('original_currency', {
      length: 3,
    }).$type<FiatCurrency>(),
    originalAmount: doublePrecision('original_amount'),
    originalRate: doublePrecision('original_rate'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('expenses_group_id_uq').on(table.groupId, table.id),
    foreignKey({
      name: 'expenses_payer_fk',
      columns: [table.groupId, table.paidByMemberId],
      foreignColumns: [groupMembers.groupId, groupMembers.id],
    }),
    index('expenses_group_created_idx').on(table.groupId, table.createdAt),
    check(
      'expenses_amount_ck',
      sql`${table.amountCents} > 0 and ${table.amountCents} <= 100000000`,
    ),
    check(
      'expenses_category_ck',
      sql`${table.category} in ('transport', 'housing', 'food', 'groceries', 'fun', 'other')`,
    ),
    check(
      'expenses_split_mode_ck',
      sql`${table.splitMode} in ('equal', 'exact', 'percent', 'shares')`,
    ),
    check(
      'expenses_original_ck',
      sql`(${table.originalCurrency} is null and ${table.originalAmount} is null and ${table.originalRate} is null)
        or (${table.originalCurrency} in ('KZT', 'RUB', 'CNY', 'EUR', 'USD')
          and ${table.originalAmount} > 0 and ${table.originalRate} > 0)`,
    ),
    check('expenses_title_ck', sql`length(btrim(${table.title})) > 0`),
  ],
);

/**
 * Доля участника в расходе, в центах. Сумма долей = сумме расхода (проверяет сервис).
 * Участник — из той же группы, что и расход (составные ключи).
 */
export const expenseShares = pgTable(
  'expense_shares',
  {
    expenseId: uuid('expense_id').notNull(),
    groupId: uuid('group_id').notNull(),
    memberId: uuid('member_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.expenseId, table.memberId] }),
    foreignKey({
      name: 'expense_shares_expense_fk',
      columns: [table.groupId, table.expenseId],
      foreignColumns: [expenses.groupId, expenses.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'expense_shares_member_fk',
      columns: [table.groupId, table.memberId],
      foreignColumns: [groupMembers.groupId, groupMembers.id],
    }),
    index('expense_shares_group_idx').on(table.groupId),
    check('expense_shares_amount_ck', sql`${table.amountCents} >= 0`),
  ],
);
