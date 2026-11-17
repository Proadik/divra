import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import {
  type SettlementStatus,
  type Stablecoin,
  groupMembers,
  groups,
  payments,
  settlementTransfers,
  settlements,
} from '../../database/schema/index.js';

export interface SettlementTransferRecord {
  memberId: string;
  name: string;
  address: string;
  amountCents: number;
}

export interface SettlementRecord {
  id: string;
  groupId: string;
  payerMemberId: string;
  createdBy: string | null;
  payerAddress: string;
  token: Stablecoin;
  mint: string;
  reference: string;
  status: SettlementStatus;
  signature: string | null;
  expiresAt: Date;
  submittedAt: Date | null;
  transfers: SettlementTransferRecord[];
}

export type NewSettlement = Omit<
  SettlementRecord,
  'id' | 'status' | 'signature' | 'submittedAt' | 'transfers'
> & { transfers: Array<Omit<SettlementTransferRecord, 'name'>> };

@Injectable()
export class SettlementsRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async create(input: NewSettlement): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(settlements)
        .values({
          groupId: input.groupId,
          payerMemberId: input.payerMemberId,
          createdBy: input.createdBy,
          payerAddress: input.payerAddress,
          token: input.token,
          mint: input.mint,
          reference: input.reference,
          expiresAt: input.expiresAt,
        })
        .returning({ id: settlements.id });
      if (!created) {
        throw new Error('Расчёт не создан');
      }
      await tx.insert(settlementTransfers).values(
        input.transfers.map((transfer) => ({
          settlementId: created.id,
          groupId: input.groupId,
          memberId: transfer.memberId,
          address: transfer.address,
          amountCents: transfer.amountCents,
        })),
      );
      return created.id;
    });
  }

  async find(id: string): Promise<SettlementRecord | undefined> {
    const [settlement] = await this.db
      .select({
        id: settlements.id,
        groupId: settlements.groupId,
        payerMemberId: settlements.payerMemberId,
        createdBy: settlements.createdBy,
        payerAddress: settlements.payerAddress,
        token: settlements.token,
        mint: settlements.mint,
        reference: settlements.reference,
        status: settlements.status,
        signature: settlements.signature,
        expiresAt: settlements.expiresAt,
        submittedAt: settlements.submittedAt,
      })
      .from(settlements)
      .where(eq(settlements.id, id));
    if (!settlement) {
      return undefined;
    }
    const transfers = await this.db
      .select({
        memberId: settlementTransfers.memberId,
        name: groupMembers.displayName,
        address: settlementTransfers.address,
        amountCents: settlementTransfers.amountCents,
      })
      .from(settlementTransfers)
      .innerJoin(
        groupMembers,
        eq(groupMembers.id, settlementTransfers.memberId),
      )
      .where(eq(settlementTransfers.settlementId, id))
      .orderBy(asc(groupMembers.createdAt));
    return { ...settlement, transfers };
  }

  /**
   * prepared → submitted, только один раз и пока не истёк срок: одну подписанную
   * транзакцию нельзя отправить дважды параллельными запросами.
   */
  async claimForSubmit(id: string, at: Date): Promise<boolean> {
    const claimed = await this.db
      .update(settlements)
      .set({ status: 'submitted', submittedAt: at })
      .where(
        and(
          eq(settlements.id, id),
          eq(settlements.status, 'prepared'),
          sql`${settlements.expiresAt} > ${at}`,
        ),
      )
      .returning({ id: settlements.id });
    return claimed.length > 0;
  }

  async setSignature(id: string, signature: string): Promise<void> {
    await this.db
      .update(settlements)
      .set({ signature })
      .where(eq(settlements.id, id));
  }

  async markFailed(id: string): Promise<void> {
    await this.db
      .update(settlements)
      .set({ status: 'failed' })
      .where(and(eq(settlements.id, id), eq(settlements.status, 'submitted')));
  }

  /**
   * Атомарно: переводы из сверки — в журнал (гасят долги), расчёт — confirmed.
   * Уже записанные по этой транзакции переводы повторно не пишутся.
   */
  async confirm(
    settlement: SettlementRecord,
    verified: ReadonlyArray<{ memberId: string; amountCents: number }>,
    signature: string,
    at: Date,
  ): Promise<'recorded' | 'already'> {
    return this.db.transaction(async (tx) => {
      const [open] = await tx
        .select({ id: settlements.id })
        .from(settlements)
        .where(
          and(
            eq(settlements.id, settlement.id),
            eq(settlements.status, 'submitted'),
          ),
        )
        .for('update');
      if (!open) {
        return 'already' as const;
      }
      // Перевод получателю по этой транзакции уже засчитан (например, совпал с оплатой
      // по запросу) — второй раз не пишем, остальные переводы записываются
      await tx
        .insert(payments)
        .values(
          verified.map((transfer) => ({
            groupId: settlement.groupId,
            fromMemberId: settlement.payerMemberId,
            toMemberId: transfer.memberId,
            amountCents: transfer.amountCents,
            token: settlement.token,
            signature,
            settlementId: settlement.id,
            createdAt: at,
          })),
        )
        .onConflictDoNothing({
          target: [payments.signature, payments.toMemberId],
        });
      await tx
        .update(settlements)
        .set({ status: 'confirmed', confirmedAt: at, signature })
        .where(eq(settlements.id, settlement.id));
      await tx
        .update(groups)
        .set({ lastActivityAt: at })
        .where(eq(groups.id, settlement.groupId));
      return 'recorded' as const;
    });
  }

  /** Отправленные, но ещё не сверенные — для фоновой проверки */
  async dueSubmitted(limit: number, before: Date): Promise<string[]> {
    const rows = await this.db
      .select({ id: settlements.id })
      .from(settlements)
      .where(
        and(
          eq(settlements.status, 'submitted'),
          isNotNull(settlements.signature),
          lt(settlements.submittedAt, before),
        ),
      )
      .orderBy(asc(settlements.submittedAt))
      .limit(limit);
    return rows.map((row) => row.id);
  }
}
