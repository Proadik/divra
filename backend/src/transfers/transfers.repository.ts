import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  aliasedTable,
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  ne,
  sql,
} from 'drizzle-orm';
import type {
  Database,
  DatabaseExecutor,
} from '../database/database.module.js';
import {
  type Stablecoin,
  chainStreamState,
  detectedTransfers,
  groupMembers,
  groups,
  paymentRequests,
  payments,
  settlements,
  users,
  walletAccounts,
} from '../database/schema/index.js';
import { netDebts } from '../groups/ledger.js';
import { loadDebtTotals } from '../groups/repositories/drizzle-expenses.repository.js';
import { rethrowUniqueViolation } from '../database/unique-violation.js';
import { UniqueViolationError } from '../common/errors/unique-violation.error.js';

/** Где отправитель должен получателю: группа и пара участников */
export interface PairDebt {
  groupId: string;
  groupName: string;
  fromMemberId: string;
  toMemberId: string;
  fromName: string;
  owedCents: number;
}

export interface DetectedTransferRecord {
  id: string;
  signature: string;
  token: Stablecoin;
  mint: string;
  rawAmount: bigint;
  fromUserId: string;
  toUserId: string;
  fromAddress: string;
  toAddress: string;
  createdAt: Date;
}

export type ApplyTransferResult =
  | {
      ok: true;
      groupId: string;
      amountCents: number;
      remainingCents: number;
    }
  | {
      ok: false;
      reason: 'not-found' | 'no-debt' | 'already-counted';
    };

const STREAM_NAME = 'transfers';

const detectedColumns = {
  id: detectedTransfers.id,
  signature: detectedTransfers.signature,
  token: detectedTransfers.token,
  mint: detectedTransfers.mint,
  rawAmount: detectedTransfers.rawAmount,
  fromUserId: detectedTransfers.fromUserId,
  toUserId: detectedTransfers.toUserId,
  fromAddress: detectedTransfers.fromAddress,
  toAddress: detectedTransfers.toAddress,
  createdAt: detectedTransfers.createdAt,
};

@Injectable()
export class TransfersRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  /**
   * Кошельки, переводы на которые стоит замечать: пользователь не выключил функцию и состоит
   * в группе, где есть ещё хотя бы один участник с кошельком.
   */
  async watchedOwners(): Promise<string[]> {
    const other = aliasedTable(groupMembers, 'other');
    const rows = await this.db
      .selectDistinct({ address: walletAccounts.address })
      .from(walletAccounts)
      .innerJoin(
        users,
        and(
          eq(users.id, walletAccounts.userId),
          eq(users.detectTransfers, true),
        ),
      )
      .innerJoin(
        groupMembers,
        and(eq(groupMembers.userId, users.id), isNull(groupMembers.leftAt)),
      )
      .where(
        and(
          eq(walletAccounts.chain, 'solana'),
          exists(
            this.db
              .select({ id: other.id })
              .from(other)
              .where(
                and(
                  eq(other.groupId, groupMembers.groupId),
                  ne(other.id, groupMembers.id),
                  sql`${other.userId} is not null`,
                  isNull(other.leftAt),
                ),
              ),
          ),
        ),
      );
    return rows.map((row) => row.address);
  }

  /** Владельцы кошельков среди этих адресов: адрес → пользователь и его настройка */
  async usersByAddresses(
    addresses: readonly string[],
  ): Promise<Map<string, { userId: string; detectTransfers: boolean }>> {
    if (addresses.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({
        address: walletAccounts.address,
        userId: users.id,
        detectTransfers: users.detectTransfers,
      })
      .from(walletAccounts)
      .innerJoin(users, eq(users.id, walletAccounts.userId))
      .where(
        and(
          eq(walletAccounts.chain, 'solana'),
          inArray(walletAccounts.address, [...addresses]),
        ),
      );
    return new Map(
      rows.map((row) => [
        row.address,
        { userId: row.userId, detectTransfers: row.detectTransfers },
      ]),
    );
  }

  /** Есть ли среди аккаунтов транзакции reference нашего запроса или расчёта */
  async hasKnownReference(accounts: readonly string[]): Promise<boolean> {
    if (accounts.length === 0) {
      return false;
    }
    const list = [...accounts];
    const [request] = await this.db
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(inArray(paymentRequests.reference, list))
      .limit(1);
    if (request) {
      return true;
    }
    const [settlement] = await this.db
      .select({ id: settlements.id })
      .from(settlements)
      .where(inArray(settlements.reference, list))
      .limit(1);
    return Boolean(settlement);
  }

  /** Группы, где fromUser сейчас должен toUser (после зачёта), и сколько */
  async debtsBetween(
    fromUserId: string,
    toUserId: string,
    db: DatabaseExecutor = this.db,
  ): Promise<PairDebt[]> {
    const from = aliasedTable(groupMembers, 'from_member');
    const to = aliasedTable(groupMembers, 'to_member');
    const pairs = await db
      .select({
        groupId: groups.id,
        groupName: groups.name,
        fromMemberId: from.id,
        fromName: from.displayName,
        toMemberId: to.id,
      })
      .from(from)
      .innerJoin(
        to,
        and(
          eq(to.groupId, from.groupId),
          eq(to.userId, toUserId),
          isNull(to.leftAt),
        ),
      )
      .innerJoin(groups, eq(groups.id, from.groupId))
      .where(and(eq(from.userId, fromUserId), isNull(from.leftAt)));
    if (pairs.length === 0) {
      return [];
    }
    const ledgers = await loadDebtTotals(
      db,
      pairs.map((pair) => pair.groupId),
    );
    return pairs.flatMap((pair) => {
      const owed =
        netDebts(ledgers.get(pair.groupId)?.totals ?? []).find(
          (debt) =>
            debt.fromId === pair.fromMemberId && debt.toId === pair.toMemberId,
        )?.cents ?? 0;
      return owed > 0 ? [{ ...pair, owedCents: owed }] : [];
    });
  }

  /** Новая подсказка; тот же перевод тому же получателю второй раз не пишется (undefined) */
  async insert(input: {
    signature: string;
    slot: number;
    token: Stablecoin;
    mint: string;
    rawAmount: bigint;
    fromUserId: string;
    toUserId: string;
    fromAddress: string;
    toAddress: string;
  }): Promise<string | undefined> {
    const [row] = await this.db
      .insert(detectedTransfers)
      .values(input)
      .onConflictDoNothing()
      .returning({ id: detectedTransfers.id });
    return row?.id;
  }

  async listPending(
    userId: string,
    since: Date,
  ): Promise<DetectedTransferRecord[]> {
    return this.db
      .select(detectedColumns)
      .from(detectedTransfers)
      .where(
        and(
          eq(detectedTransfers.toUserId, userId),
          eq(detectedTransfers.status, 'pending'),
          gt(detectedTransfers.createdAt, since),
        ),
      )
      .orderBy(desc(detectedTransfers.createdAt))
      .limit(20);
  }

  async findPending(
    id: string,
    userId: string,
  ): Promise<DetectedTransferRecord | undefined> {
    const [row] = await this.db
      .select(detectedColumns)
      .from(detectedTransfers)
      .where(
        and(
          eq(detectedTransfers.id, id),
          eq(detectedTransfers.toUserId, userId),
          eq(detectedTransfers.status, 'pending'),
        ),
      );
    return row;
  }

  async dismiss(id: string, userId: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(detectedTransfers)
      .set({ status: 'dismissed', resolvedAt: at })
      .where(
        and(
          eq(detectedTransfers.id, id),
          eq(detectedTransfers.toUserId, userId),
          eq(detectedTransfers.status, 'pending'),
        ),
      )
      .returning({ id: detectedTransfers.id });
    return rows.length > 0;
  }

  /**
   * Засчитать подсказку в группе: под блокировками подсказки и группы пересчитывает долг
   * и записывает перевод (не больше долга). Открытый запрос этой пары закрывается: покрыт —
   * оплачен этой записью, частично — отменён (как у наличных).
   */
  async apply(input: {
    id: string;
    userId: string;
    groupId: string;
    at: Date;
  }): Promise<ApplyTransferResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const [transfer] = await tx
          .select(detectedColumns)
          .from(detectedTransfers)
          .where(
            and(
              eq(detectedTransfers.id, input.id),
              eq(detectedTransfers.toUserId, input.userId),
              eq(detectedTransfers.status, 'pending'),
            ),
          )
          .for('update');
        if (!transfer) {
          return { ok: false, reason: 'not-found' } as const;
        }
        await tx
          .select({ id: groups.id })
          .from(groups)
          .where(eq(groups.id, input.groupId))
          .for('update');
        const debt = (
          await this.debtsBetween(transfer.fromUserId, input.userId, tx)
        ).find((item) => item.groupId === input.groupId);
        if (!debt) {
          return { ok: false, reason: 'no-debt' } as const;
        }
        const transferCents = Number(transfer.rawAmount / 10_000n);
        const amountCents = Math.min(transferCents, debt.owedCents);
        if (amountCents <= 0) {
          return { ok: false, reason: 'no-debt' } as const;
        }

        const [open] = await tx
          .select({
            id: paymentRequests.id,
            amountCents: paymentRequests.amountCents,
          })
          .from(paymentRequests)
          .where(
            and(
              eq(paymentRequests.groupId, input.groupId),
              eq(paymentRequests.requesterMemberId, debt.toMemberId),
              eq(paymentRequests.debtorMemberId, debt.fromMemberId),
              isNull(paymentRequests.paidAt),
              isNull(paymentRequests.replacedAt),
            ),
          )
          .for('update');
        const closesRequest = open && amountCents >= open.amountCents;
        const [payment] = await rethrowUniqueViolation(
          tx
            .insert(payments)
            .values({
              groupId: input.groupId,
              fromMemberId: debt.fromMemberId,
              toMemberId: debt.toMemberId,
              amountCents,
              method: 'onchain',
              token: transfer.token,
              signature: transfer.signature,
              recordedBy: input.userId,
              requestId: closesRequest ? open.id : null,
              createdAt: input.at,
            })
            .returning({ id: payments.id }),
        );
        if (open) {
          await tx
            .update(paymentRequests)
            .set(
              closesRequest
                ? { paidAt: input.at }
                : { replacedAt: input.at, cancelledAt: input.at },
            )
            .where(eq(paymentRequests.id, open.id));
        }
        await tx
          .update(detectedTransfers)
          .set({
            status: 'applied',
            resolvedAt: input.at,
            paymentId: payment?.id ?? null,
          })
          .where(eq(detectedTransfers.id, transfer.id));
        await tx
          .update(groups)
          .set({ lastActivityAt: input.at })
          .where(eq(groups.id, input.groupId));
        return {
          ok: true,
          groupId: input.groupId,
          amountCents,
          remainingCents: debt.owedCents - amountCents,
        } as const;
      });
    } catch (error) {
      // Эту транзакцию этому участнику уже засчитали (например, как оплату по запросу)
      if (error instanceof UniqueViolationError) {
        return { ok: false, reason: 'already-counted' };
      }
      throw error;
    }
  }

  async loadSlot(): Promise<number | null> {
    const [row] = await this.db
      .select({ lastSlot: chainStreamState.lastSlot })
      .from(chainStreamState)
      .where(eq(chainStreamState.name, STREAM_NAME));
    return row?.lastSlot ?? null;
  }

  async saveSlot(slot: number): Promise<void> {
    await this.db
      .insert(chainStreamState)
      .values({ name: STREAM_NAME, lastSlot: slot, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: chainStreamState.name,
        set: { lastSlot: slot, updatedAt: new Date() },
        // Слоты приходят не строго по порядку — назад не откатываемся
        setWhere: sql`${chainStreamState.lastSlot} < ${slot}`,
      });
  }
}
