import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.schema.js';

/** Тип группы — от него иконка в списке */
export const GROUP_KINDS = ['trip', 'home', 'food', 'other'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

/**
 * Группа общих расходов. Видна и доступна только своим участникам:
 * чужой id для API неотличим от несуществующего (404).
 */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 40 }).notNull(),
    kind: varchar('kind', { length: 16 }).$type<GroupKind>().notNull(),
    /** Создатель. Аккаунт удалён — группа остаётся у остальных участников */
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Последний расход или перевод — по нему сортируется список на главной */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'groups_kind_ck',
      sql`${table.kind} in ('trip', 'home', 'food', 'other')`,
    ),
    check('groups_name_ck', sql`length(btrim(${table.name})) > 0`),
  ],
);

/**
 * Участник группы. user_id = null — добавлен по имени и ещё не подключил кошелёк (pending):
 * участвует в расходах и долгах, но перевести ему нельзя. Подключился — user_id заполнен (active).
 */
export const groupMembers = pgTable(
  'group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    displayName: varchar('display_name', { length: 32 }).notNull(),
    /** Кто добавил (для pending) или null — вошёл сам (создатель, по ссылке) */
    addedBy: uuid('added_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Когда подключил кошелёк; у pending — null. Без CHECK на связь с user_id:
     * при удалении аккаунта user_id обнуляется, а дата остаётся историей
     */
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    /**
     * Вышел или удалён из группы. Строка остаётся: на неё ссылаются старые расходы и переводы.
     * Уйти можно только без долгов, поэтому на журнал это не влияет
     */
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    // Цель составных внешних ключей расходов: участник обязательно из той же группы
    unique('group_members_group_id_uq').on(table.groupId, table.id),
    // Один пользователь — один участник в группе
    uniqueIndex('group_members_group_user_uq')
      .on(table.groupId, table.userId)
      .where(sql`${table.userId} is not null`),
    // Два «Ержана» в одной группе не различить ни в расходах, ни в долгах.
    // Имя ушедшего освобождается
    uniqueIndex('group_members_group_name_uq')
      .on(table.groupId, sql`lower(${table.displayName})`)
      .where(sql`${table.leftAt} is null`),
    index('group_members_user_idx').on(table.userId),
    check(
      'group_members_name_ck',
      sql`length(btrim(${table.displayName})) > 0`,
    ),
  ],
);
