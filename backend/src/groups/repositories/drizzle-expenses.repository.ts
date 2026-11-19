import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  aliasedTable,
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type {
  Database,
  DatabaseExecutor,
  Transaction as Tx,
} from '../../database/database.module.js';
import {
  expenseShares,
  expenses,
  groupMembers,
  groups,
  payments,
} from '../../database/schema/index.js';
import type { DebtTotal } from '../ledger.js';
import {
  type ActivityRecord,
  type CreateExpenseResult,
  type DeleteExpenseResult,
  type ExpenseDetailRecord,
  type ExpenseRecord,
  ExpensesRepository,
  type NewExpense,
  type UpdateExpenseResult,
} from './expenses.repository.js';

const me = aliasedTable(groupMembers, 'me');
const myShare = aliasedTable(expenseShares, 'my_share');
const payer = aliasedTable(groupMembers, 'payer');

/** Править расход может его автор или плательщик. Нужен join payer */
const canEditColumn = (userId: string) =>
  sql<boolean>`(${expenses.createdBy} = ${userId} or ${payer.userId} = ${userId})`.mapWith(
    Boolean,
  );

const expenseColumns = {
  id: expenses.id,
  title: expenses.title,
  category: expenses.category,
  paidByMemberId: expenses.paidByMemberId,
  amountCents: expenses.amountCents,
  myShareCents: sql<number>`coalesce(${myShare.amountCents}, 0)`.mapWith(
    Number,
  ),
  originalCurrency: expenses.originalCurrency,
  originalAmount: expenses.originalAmount,
  originalRate: expenses.originalRate,
  createdAt: expenses.createdAt,
};

type ExpenseRow = {
  [K in keyof typeof expenseColumns]: K extends 'myShareCents'
    ? number
    : (typeof expenses.$inferSelect)[K extends keyof typeof expenses.$inferSelect
        ? K
        : never];
} & { canEdit: boolean };

/** Участник userId в группе с блокировкой группы: состав не меняется, пока пишем */
const lockMembership = async (
  tx: Tx,
  groupId: string,
  userId: string,
): Promise<string | undefined> => {
  const [membership] = await tx
    .select({ memberId: groupMembers.id })
    .from(groups)
    .innerJoin(
      groupMembers,
      and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)),
    )
    .where(eq(groups.id, groupId))
    .for('update', { of: groups });
  return membership?.memberId;
};

/** Плательщик и все доли — действующие участники этой группы */
const allActiveMembers = async (
  db: DatabaseExecutor,
  groupId: string,
  input: NewExpense,
): Promise<boolean> => {
  const referenced = [
    ...new Set([
      input.paidByMemberId,
      ...input.shares.map((share) => share.memberId),
    ]),
  ];
  const found = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        inArray(groupMembers.id, referenced),
        isNull(groupMembers.leftAt),
      ),
    );
  return found.length === referenced.length;
};

const toRecord = ({
  originalCurrency,
  originalAmount,
  originalRate,
  ...row
}: ExpenseRow): ExpenseRecord => ({
  ...row,
  original:
    originalCurrency && originalAmount && originalRate
      ? {
          currency: originalCurrency,
          amount: originalAmount,
          rate: originalRate,
        }
      : null,
});

/**
 * Сырые долги по группам (см. ExpensesRepository.debtTotals). Отдельной функцией —
 * чтобы проверять долги внутри чужой транзакции (выход из группы, наличные).
 */
export const loadDebtTotals = async (
  db: DatabaseExecutor,
  groupIds: string[],
): Promise<Map<string, { totals: DebtTotal[]; transfers: number }>> => {
  const result = new Map<string, { totals: DebtTotal[]; transfers: number }>();
  if (groupIds.length === 0) {
    return result;
  }
  const rows = await db
    .select({
      groupId: expenseShares.groupId,
      fromId: expenseShares.memberId,
      toId: expenses.paidByMemberId,
      cents: sql<number>`sum(${expenseShares.amountCents})`.mapWith(Number),
      transfers: sql<number>`count(*)`.mapWith(Number),
    })
    .from(expenseShares)
    .innerJoin(
      expenses,
      and(
        eq(expenses.id, expenseShares.expenseId),
        eq(expenses.groupId, expenseShares.groupId),
      ),
    )
    .where(
      and(
        inArray(expenseShares.groupId, groupIds),
        ne(expenseShares.memberId, expenses.paidByMemberId),
        gt(expenseShares.amountCents, 0),
      ),
    )
    .groupBy(
      expenseShares.groupId,
      expenseShares.memberId,
      expenses.paidByMemberId,
    );
  // Перевод from → to гасит долг from перед to: в журнал он идёт встречным долгом to → from
  const paid = await db
    .select({
      groupId: payments.groupId,
      fromId: payments.toMemberId,
      toId: payments.fromMemberId,
      cents: sql<number>`sum(${payments.amountCents})`.mapWith(Number),
      transfers: sql<number>`0`.mapWith(Number),
    })
    .from(payments)
    .where(inArray(payments.groupId, groupIds))
    .groupBy(payments.groupId, payments.fromMemberId, payments.toMemberId);
  // Сколько переводов было бы без взаимозачёта: пары «кто → кому» по расходам,
  // где после уже сделанных переводов ещё что-то осталось
  const paidByPair = new Map(
    paid.map((row) => [`${row.groupId}:${row.toId}>${row.fromId}`, row.cents]),
  );
  for (const row of [...rows, ...paid]) {
    const entry = result.get(row.groupId) ?? { totals: [], transfers: 0 };
    entry.totals.push({
      fromId: row.fromId,
      toId: row.toId,
      cents: row.cents,
    });
    const isExpensePair = row.transfers > 0;
    const left =
      row.cents -
      (paidByPair.get(`${row.groupId}:${row.fromId}>${row.toId}`) ?? 0);
    if (isExpensePair && left > 0) {
      entry.transfers += 1;
    }
    result.set(row.groupId, entry);
  }
  return result;
};

@Injectable()
export class DrizzleExpensesRepository extends ExpensesRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {
    super();
  }

  async create(
    groupId: string,
    userId: string,
    input: NewExpense,
  ): Promise<CreateExpenseResult> {
    return this.db.transaction(async (tx) => {
      const memberId = await lockMembership(tx, groupId, userId);
      if (!memberId) {
        return { ok: false, reason: 'not-member' } as const;
      }
      if (!(await allActiveMembers(tx, groupId, input))) {
        return { ok: false, reason: 'foreign-member' } as const;
      }

      const now = new Date();
      const [created] = await tx
        .insert(expenses)
        .values({
          groupId,
          title: input.title,
          category: input.category,
          paidByMemberId: input.paidByMemberId,
          amountCents: input.amountCents,
          splitMode: input.splitMode,
          originalCurrency: input.original?.currency ?? null,
          originalAmount: input.original?.amount ?? null,
          originalRate: input.original?.rate ?? null,
          createdBy: userId,
          createdAt: now,
        })
        .returning({ id: expenses.id, createdAt: expenses.createdAt });
      if (!created) {
        throw new Error('Расход не записан');
      }
      const shares = input.shares.filter((share) => share.amountCents > 0);
      await tx.insert(expenseShares).values(
        shares.map((share) => ({
          expenseId: created.id,
          groupId,
          memberId: share.memberId,
          amountCents: share.amountCents,
        })),
      );
      await tx
        .update(groups)
        .set({ lastActivityAt: now })
        .where(eq(groups.id, groupId));

      return {
        ok: true,
        expense: {
          id: created.id,
          title: input.title,
          category: input.category,
          paidByMemberId: input.paidByMemberId,
          amountCents: input.amountCents,
          myShareCents:
            shares.find((share) => share.memberId === memberId)?.amountCents ??
            0,
          original: input.original,
          createdAt: created.createdAt,
          canEdit: true,
        },
      } as const;
    });
  }

  async findDetail(
    groupId: string,
    expenseId: string,
    userId: string,
  ): Promise<ExpenseDetailRecord | undefined> {
    const [row] = await this.db
      .select({
        ...expenseColumns,
        canEdit: canEditColumn(userId),
        splitMode: expenses.splitMode,
        updatedAt: expenses.updatedAt,
      })
      .from(expenses)
      .innerJoin(
        me,
        and(eq(me.groupId, expenses.groupId), eq(me.userId, userId)),
      )
      .innerJoin(payer, eq(payer.id, expenses.paidByMemberId))
      .leftJoin(
        myShare,
        and(eq(myShare.expenseId, expenses.id), eq(myShare.memberId, me.id)),
      )
      .where(and(eq(expenses.groupId, groupId), eq(expenses.id, expenseId)));
    if (!row) {
      return undefined;
    }
    const { splitMode, updatedAt, ...rest } = row;
    const shares = await this.db
      .select({
        memberId: expenseShares.memberId,
        amountCents: expenseShares.amountCents,
      })
      .from(expenseShares)
      .where(
        and(
          eq(expenseShares.groupId, groupId),
          eq(expenseShares.expenseId, expenseId),
        ),
      );
    return { ...toRecord(rest), splitMode, updatedAt, shares };
  }

  async update(
    groupId: string,
    expenseId: string,
    userId: string,
    input: NewExpense,
  ): Promise<UpdateExpenseResult> {
    return this.db.transaction(async (tx) => {
      const memberId = await lockMembership(tx, groupId, userId);
      if (!memberId) {
        return { ok: false, reason: 'not-member' } as const;
      }
      const access = await this.editAccess(tx, groupId, expenseId, userId);
      if (access !== 'ok') {
        return { ok: false, reason: access } as const;
      }
      if (!(await allActiveMembers(tx, groupId, input))) {
        return { ok: false, reason: 'foreign-member' } as const;
      }
      const now = new Date();
      const [updated] = await tx
        .update(expenses)
        .set({
          title: input.title,
          category: input.category,
          paidByMemberId: input.paidByMemberId,
          amountCents: input.amountCents,
          splitMode: input.splitMode,
          originalCurrency: input.original?.currency ?? null,
          originalAmount: input.original?.amount ?? null,
          originalRate: input.original?.rate ?? null,
          updatedAt: now,
        })
        .where(and(eq(expenses.groupId, groupId), eq(expenses.id, expenseId)))
        .returning({ createdAt: expenses.createdAt });
      if (!updated) {
        return { ok: false, reason: 'not-found' } as const;
      }
      await tx
        .delete(expenseShares)
        .where(
          and(
            eq(expenseShares.groupId, groupId),
            eq(expenseShares.expenseId, expenseId),
          ),
        );
      const shares = input.shares.filter((share) => share.amountCents > 0);
      await tx.insert(expenseShares).values(
        shares.map((share) => ({
          expenseId,
          groupId,
          memberId: share.memberId,
          amountCents: share.amountCents,
        })),
      );
      await tx
        .update(groups)
        .set({ lastActivityAt: now })
        .where(eq(groups.id, groupId));
      return {
        ok: true,
        expense: {
          id: expenseId,
          title: input.title,
          category: input.category,
          paidByMemberId: input.paidByMemberId,
          amountCents: input.amountCents,
          myShareCents:
            shares.find((share) => share.memberId === memberId)?.amountCents ??
            0,
          original: input.original,
          createdAt: updated.createdAt,
          canEdit: true,
        },
      } as const;
    });
  }

  async remove(
    groupId: string,
    expenseId: string,
    userId: string,
  ): Promise<DeleteExpenseResult> {
    return this.db.transaction(async (tx) => {
      const memberId = await lockMembership(tx, groupId, userId);
      if (!memberId) {
        return { ok: false, reason: 'not-member' } as const;
      }
      const access = await this.editAccess(tx, groupId, expenseId, userId);
      if (access !== 'ok') {
        return { ok: false, reason: access } as const;
      }
      // Доли удалятся каскадом (expense_shares_expense_fk)
      await tx
        .delete(expenses)
        .where(and(eq(expenses.groupId, groupId), eq(expenses.id, expenseId)));
      return { ok: true } as const;
    });
  }

  /** Расход есть в группе, и userId — его автор или плательщик. Строка расхода блокируется */
  private async editAccess(
    tx: Tx,
    groupId: string,
    expenseId: string,
    userId: string,
  ): Promise<'ok' | 'not-found' | 'forbidden'> {
    const [row] = await tx
      .select({ canEdit: canEditColumn(userId) })
      .from(expenses)
      .innerJoin(payer, eq(payer.id, expenses.paidByMemberId))
      .where(and(eq(expenses.groupId, groupId), eq(expenses.id, expenseId)))
      .for('update', { of: expenses });
    if (!row) {
      return 'not-found';
    }
    return row.canEdit ? 'ok' : 'forbidden';
  }

  async listForGroup(
    groupId: string,
    userId: string,
    limit: number,
  ): Promise<ExpenseRecord[]> {
    const rows = await this.db
      .select({ ...expenseColumns, canEdit: canEditColumn(userId) })
      .from(expenses)
      .innerJoin(payer, eq(payer.id, expenses.paidByMemberId))
      .leftJoin(
        me,
        and(eq(me.groupId, expenses.groupId), eq(me.userId, userId)),
      )
      .leftJoin(
        myShare,
        and(eq(myShare.expenseId, expenses.id), eq(myShare.memberId, me.id)),
      )
      .where(eq(expenses.groupId, groupId))
      .orderBy(desc(expenses.createdAt), desc(expenses.id))
      .limit(limit);
    return rows.map(toRecord);
  }

  debtTotals(
    groupIds: string[],
  ): Promise<Map<string, { totals: DebtTotal[]; transfers: number }>> {
    return loadDebtTotals(this.db, groupIds);
  }

  async recentForUser(
    userId: string,
    limit: number,
  ): Promise<ActivityRecord[]> {
    const rows = await this.db
      .select({
        ...expenseColumns,
        canEdit: canEditColumn(userId),
        groupId: groups.id,
        groupName: groups.name,
        payerName: payer.displayName,
        payerUserId: payer.userId,
      })
      .from(expenses)
      .innerJoin(
        me,
        and(eq(me.groupId, expenses.groupId), eq(me.userId, userId)),
      )
      .innerJoin(groups, eq(groups.id, expenses.groupId))
      .innerJoin(payer, eq(payer.id, expenses.paidByMemberId))
      .leftJoin(
        myShare,
        and(eq(myShare.expenseId, expenses.id), eq(myShare.memberId, me.id)),
      )
      .where(
        // Только то, что изменило твой баланс: платил другой, а у тебя доля, или платил ты не только за себя
        or(
          and(ne(expenses.paidByMemberId, me.id), gt(myShare.amountCents, 0)),
          and(
            eq(expenses.paidByMemberId, me.id),
            sql`${expenses.amountCents} <> coalesce(${myShare.amountCents}, 0)`,
          ),
        ),
      )
      .orderBy(desc(expenses.createdAt), desc(expenses.id))
      .limit(limit);
    const fromMember = aliasedTable(groupMembers, 'from_member');
    const toMember = aliasedTable(groupMembers, 'to_member');
    const transfers = await this.db
      .select({
        id: payments.id,
        groupId: groups.id,
        groupName: groups.name,
        amountCents: payments.amountCents,
        method: payments.method,
        signature: payments.signature,
        createdAt: payments.createdAt,
        fromName: fromMember.displayName,
        fromUserId: fromMember.userId,
        toName: toMember.displayName,
        toUserId: toMember.userId,
      })
      .from(payments)
      .innerJoin(
        me,
        and(eq(me.groupId, payments.groupId), eq(me.userId, userId)),
      )
      .innerJoin(groups, eq(groups.id, payments.groupId))
      .innerJoin(fromMember, eq(fromMember.id, payments.fromMemberId))
      .innerJoin(toMember, eq(toMember.id, payments.toMemberId))
      .where(
        or(eq(payments.fromMemberId, me.id), eq(payments.toMemberId, me.id)),
      )
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(limit);

    const items: ActivityRecord[] = [
      ...rows.map(
        ({
          groupId,
          groupName,
          payerName,
          payerUserId,
          ...row
        }): ActivityRecord => ({
          ...toRecord(row),
          kind: 'expense',
          groupId,
          groupName,
          payer: { name: payerName, userId: payerUserId },
        }),
      ),
      ...transfers.map((row): ActivityRecord => ({
        kind: 'payment',
        id: row.id,
        groupId: row.groupId,
        groupName: row.groupName,
        amountCents: row.amountCents,
        method: row.method,
        signature: row.signature,
        createdAt: row.createdAt,
        from: { name: row.fromName, userId: row.fromUserId },
        to: { name: row.toName, userId: row.toUserId },
      })),
    ];
    return items
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}
