import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { groupMembers, groups } from './groups.schema.js';
import { users } from './users.schema.js';

export const STABLECOINS = ['USDC', 'USDT'] as const;
export type Stablecoin = (typeof STABLECOINS)[number];

/**
 * Запрос на оплату (Solana Pay). Должник платит напрямую на кошелёк получателя;
 * Divra денег не касается, а оплату находит в сети по уникальному reference.
 * code — 128 бит случайности: по нему страницу открывают без входа.
 */
export const paymentRequests = pgTable(
  'payment_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 32 }).notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /** Кому платят */
    requesterMemberId: uuid('requester_member_id').notNull(),
    /** Кто платит */
    debtorMemberId: uuid('debtor_member_id').notNull(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Кошелёк получателя — один из кошельков requester (проверяет сервис) */
    recipient: varchar('recipient', { length: 44 }).notNull(),
    token: varchar('token', { length: 4 }).$type<Stablecoin>().notNull(),
    mint: varchar('mint', { length: 44 }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    /** Solana Pay reference: случайный публичный ключ, по нему ищем транзакцию */
    reference: varchar('reference', { length: 44 }).notNull(),
    message: varchar('message', { length: 140 }).notNull().default(''),
    remindInDays: integer('remind_in_days'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Когда последний раз искали оплату в сети */
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /**
     * Заменён новым запросом тому же должнику (долг изменился). Ссылка больше не принимает
     * оплату, но если перевод по ней всё же придёт — он будет засчитан.
     */
    replacedAt: timestamp('replaced_at', { withTimezone: true }),
    /**
     * Отменён: получатель отозвал запрос, вышел из группы или долг закрыли наличными частично.
     * Вместе с ним ставится replaced_at — запрос перестаёт быть действующим
     */
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /** Когда последний раз напоминали должнику: не чаще раза в сутки */
    lastRemindedAt: timestamp('last_reminded_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('payment_requests_code_uq').on(table.code),
    // Один действующий запрос на пару «кто просит → кто должен»
    uniqueIndex('payment_requests_active_uq')
      .on(table.requesterMemberId, table.debtorMemberId)
      .where(sql`${table.paidAt} is null and ${table.replacedAt} is null`),
    uniqueIndex('payment_requests_reference_uq').on(table.reference),
    foreignKey({
      name: 'payment_requests_requester_fk',
      columns: [table.groupId, table.requesterMemberId],
      foreignColumns: [groupMembers.groupId, groupMembers.id],
    }),
    foreignKey({
      name: 'payment_requests_debtor_fk',
      columns: [table.groupId, table.debtorMemberId],
      foreignColumns: [groupMembers.groupId, groupMembers.id],
    }),
    index('payment_requests_open_idx')
      .on(table.lastCheckedAt)
      .where(sql`${table.paidAt} is null`),
    index('payment_requests_group_idx').on(table.groupId, table.createdAt),
    check(
      'payment_requests_amount_ck',
      sql`${table.amountCents} > 0 and ${table.amountCents} <= 100000000`,
    ),
    check('payment_requests_token_ck', sql`${table.token} in ('USDC', 'USDT')`),
    check(
      'payment_requests_remind_ck',
      sql`${table.remindInDays} is null or ${table.remindInDays} between 1 and 60`,
    ),
    check(
      'payment_requests_debtor_ck',
      sql`${table.requesterMemberId} <> ${table.debtorMemberId}`,
    ),
  ],
);

export const SETTLEMENT_STATUSES = [
  'prepared',
  'submitted',
  'confirmed',
  'failed',
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/**
 * «Рассчитаться»: одна транзакция с переводами нескольким участникам. Сервер собирает её,
 * кошелёк подписывает, сервер отправляет и сверяет в сети, что каждый получил свою сумму.
 * prepared → submitted → confirmed | failed. Перевод засчитывается только после сверки.
 */
export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    payerMemberId: uuid('payer_member_id').notNull(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Кошелёк плательщика — один из кошельков createdBy (проверяет сервис) */
    payerAddress: varchar('payer_address', { length: 44 }).notNull(),
    token: varchar('token', { length: 4 }).$type<Stablecoin>().notNull(),
    mint: varchar('mint', { length: 44 }).notNull(),
    /** Метка в транзакции — чтобы отличить её от чужих при проверке */
    reference: varchar('reference', { length: 44 }).notNull(),
    status: varchar('status', { length: 10 })
      .$type<SettlementStatus>()
      .notNull()
      .default('prepared'),
    signature: varchar('signature', { length: 88 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** После этого подписанную транзакцию не принимаем — blockhash устарел */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('settlements_reference_uq').on(table.reference),
    foreignKey({
      name: 'settlements_payer_fk',
      columns: [table.groupId, table.payerMemberId],
      foreignColumns: [groupMembers.groupId, groupMembers.id],
    }),
    index('settlements_submitted_idx')
      .on(table.submittedAt)
      .where(sql`${table.status} = 'submitted'`),
    check(
      'settlements_status_ck',
      sql`${table.status} in ('prepared', 'submitted', 'confirmed', 'failed')`,
    ),
    check('settlements_token_ck', sql`${table.token} in ('USDC', 'USDT')`),
  ],
);

/** Перевод внутри расчёта: кому, на какой адрес и сколько */
export const settlementTransfers = pgTable(
  'settlement_transfers',
  {
    settlementId: uuid('settlement_id')
      .notNull()
      .references(() => settlements.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').notNull(),
    memberId: uuid('member_id').notNull(),
    address: varchar('address', { length: 44 }).notNull(),
    amountCents: integer('amount_cents').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.settlementId, table.memberId] }),
    foreignKey({
      name: 'settlement_transfers_member_fk',
      columns: [table.groupId, table.memberId],
      foreignColumns: [groupMembers.groupId, groupMembers.id],
    }),
    check(
      'settlement_transfers_amount_ck',
      sql`${table.amountCents} > 0 and ${table.amountCents} <= 100000000`,
    ),
  ],
);

/**
 * Перевод между участниками, найденный в сети. Уменьшает долг from → to.
 * Пара (signature, to_member_id) уникальна: один перевод получателю не засчитывается
 * дважды — ни двумя запросами, ни запросом и расчётом сразу. В одной транзакции расчёта
 * несколько получателей — это несколько строк.
 */
export const PAYMENT_METHODS = ['onchain', 'cash'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    fromMemberId: uuid('from_member_id').notNull(),
    toMemberId: uuid('to_member_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    /**
     * onchain — перевод найден в сети (есть token и signature).
     * cash — получатель сам отметил, что получил деньги вне сети (token и signature — null)
     */
    method: varchar('method', { length: 8 })
      .$type<PaymentMethod>()
      .notNull()
      .default('onchain'),
    token: varchar('token', { length: 4 }).$type<Stablecoin>(),
    signature: varchar('signature', { length: 88 }),
    /** Кто записал наличные — только получатель (проверяет сервис) */
    recordedBy: uuid('recorded_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    requestId: uuid('request_id').references(() => paymentRequests.id, {
      onDelete: 'set null',
    }),
    settlementId: uuid('settlement_id').references(() => settlements.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('payments_signature_to_uq').on(
      table.signature,
      table.toMemberId,
    ),
    uniqueIndex('payments_request_uq')
      .on(table.requestId)
      .where(sql`${table.requestId} is not null`),
    foreignKey({
      name: 'payments_from_fk',
      columns: [table.groupId, table.fromMemberId],
      foreignColumns: [groupMembers.groupId, groupMembers.id],
    }),
    foreignKey({
      name: 'payments_to_fk',
      columns: [table.groupId, table.toMemberId],
      foreignColumns: [groupMembers.groupId, groupMembers.id],
    }),
    index('payments_group_idx').on(table.groupId, table.createdAt),
    check('payments_amount_ck', sql`${table.amountCents} > 0`),
    check(
      'payments_token_ck',
      sql`${table.token} is null or ${table.token} in ('USDC', 'USDT')`,
    ),
    check(
      'payments_method_ck',
      sql`(${table.method} = 'onchain' and ${table.signature} is not null and ${table.token} is not null)
        or (${table.method} = 'cash' and ${table.signature} is null and ${table.token} is null)`,
    ),
    check(
      'payments_members_ck',
      sql`${table.fromMemberId} <> ${table.toMemberId}`,
    ),
  ],
);
