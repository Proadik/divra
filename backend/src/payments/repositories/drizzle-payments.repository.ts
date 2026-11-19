import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { debtsOf, netDebts } from '../../groups/ledger.js';
import { loadDebtTotals } from '../../groups/repositories/drizzle-expenses.repository.js';
import {
  groupMembers,
  groups,
  paymentRequests,
  payments,
} from '../../database/schema/index.js';
import { rethrowUniqueViolation } from '../../database/unique-violation.js';
import { UniqueViolationError } from '../../common/errors/unique-violation.error.js';
import {
  type CancelRequestResult,
  type NewPaymentRequest,
  type PaymentRequestDetails,
  type PaymentRequestRecord,
  PaymentsRepository,
  type RecordCashResult,
  type RecordPaymentResult,
  type RemindResult,
} from './payments.repository.js';

const requestColumns = {
  id: paymentRequests.id,
  code: paymentRequests.code,
  groupId: paymentRequests.groupId,
  requesterMemberId: paymentRequests.requesterMemberId,
  debtorMemberId: paymentRequests.debtorMemberId,
  recipient: paymentRequests.recipient,
  token: paymentRequests.token,
  mint: paymentRequests.mint,
  amountCents: paymentRequests.amountCents,
  reference: paymentRequests.reference,
  message: paymentRequests.message,
  createdAt: paymentRequests.createdAt,
  expiresAt: paymentRequests.expiresAt,
  lastCheckedAt: paymentRequests.lastCheckedAt,
  paidAt: paymentRequests.paidAt,
  replacedAt: paymentRequests.replacedAt,
  cancelledAt: paymentRequests.cancelledAt,
  lastRemindedAt: paymentRequests.lastRemindedAt,
};

/** Действующий (не оплачен, не заменён и не отменён) запрос */
const isActive = and(
  isNull(paymentRequests.paidAt),
  isNull(paymentRequests.replacedAt),
);

@Injectable()
export class DrizzlePaymentsRepository extends PaymentsRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {
    super();
  }

  async createRequests(
    requests: NewPaymentRequest[],
    now: Date,
  ): Promise<PaymentRequestRecord[]> {
    if (requests.length === 0) {
      return [];
    }
    try {
      return await this.db.transaction(async (tx) => {
        const result: PaymentRequestRecord[] = [];
        for (const draft of requests) {
          const active = await tx
            .select(requestColumns)
            .from(paymentRequests)
            .where(
              and(
                eq(paymentRequests.requesterMemberId, draft.requesterMemberId),
                eq(paymentRequests.debtorMemberId, draft.debtorMemberId),
                isNull(paymentRequests.paidAt),
                isNull(paymentRequests.replacedAt),
              ),
            )
            .for('update');
          const same = active.find(
            (item) =>
              item.expiresAt > now &&
              item.amountCents === draft.amountCents &&
              item.token === draft.token &&
              item.recipient === draft.recipient &&
              item.message === draft.message,
          );
          if (same) {
            result.push(same);
            continue;
          }
          if (active.length > 0) {
            await tx
              .update(paymentRequests)
              .set({ replacedAt: now })
              .where(
                inArray(
                  paymentRequests.id,
                  active.map((item) => item.id),
                ),
              );
          }
          const [created] = await rethrowUniqueViolation(
            tx.insert(paymentRequests).values(draft).returning(requestColumns),
          );
          if (!created) {
            throw new Error('Запрос не создан');
          }
          result.push(created);
        }
        return result;
      });
    } catch (error) {
      // Два одновременных запроса одному должнику: второй увидит уже созданный
      if (error instanceof UniqueViolationError) {
        throw new ConflictException('Запрос уже создаётся — обнови страницу');
      }
      throw error;
    }
  }

  async listRequests(
    groupId: string,
    requesterMemberId: string,
    limit: number,
  ): Promise<PaymentRequestDetails[]> {
    return this.details()
      .where(
        and(
          eq(paymentRequests.groupId, groupId),
          eq(paymentRequests.requesterMemberId, requesterMemberId),
          or(
            isNull(paymentRequests.replacedAt),
            isNotNull(paymentRequests.paidAt),
          ),
        ),
      )
      .orderBy(desc(paymentRequests.createdAt), desc(paymentRequests.id))
      .limit(limit);
  }

  async findByCode(code: string): Promise<PaymentRequestDetails | undefined> {
    const [row] = await this.details().where(eq(paymentRequests.code, code));
    return row;
  }

  /** Запрос с названием группы и именами сторон */
  private details() {
    const requester = aliasedTable(groupMembers, 'requester');
    const debtor = aliasedTable(groupMembers, 'debtor');
    return this.db
      .select({
        ...requestColumns,
        groupName: groups.name,
        requesterName: requester.displayName,
        debtorName: debtor.displayName,
        signature: payments.signature,
      })
      .from(paymentRequests)
      .innerJoin(groups, eq(groups.id, paymentRequests.groupId))
      .innerJoin(requester, eq(requester.id, paymentRequests.requesterMemberId))
      .innerJoin(debtor, eq(debtor.id, paymentRequests.debtorMemberId))
      .leftJoin(payments, eq(payments.requestId, paymentRequests.id))
      .$dynamic();
  }

  async dueForCheck(limit: number, now: Date): Promise<PaymentRequestRecord[]> {
    return this.db
      .select(requestColumns)
      .from(paymentRequests)
      .where(
        and(isNull(paymentRequests.paidAt), gt(paymentRequests.expiresAt, now)),
      )
      .orderBy(
        sql`${paymentRequests.lastCheckedAt} asc nulls first`,
        asc(paymentRequests.createdAt),
      )
      .limit(limit);
  }

  async markChecked(requestId: string, at: Date | null): Promise<void> {
    await this.db
      .update(paymentRequests)
      .set({ lastCheckedAt: at })
      .where(eq(paymentRequests.id, requestId));
  }

  async recordPayment(
    request: PaymentRequestRecord,
    payment: { signature: string; amountCents: number },
    at: Date,
  ): Promise<RecordPaymentResult> {
    try {
      return await this.db.transaction(async (tx) => {
        // Блокировка запроса: два параллельных поиска не запишут оплату дважды
        const [open] = await tx
          .select({ id: paymentRequests.id })
          .from(paymentRequests)
          .where(
            and(
              eq(paymentRequests.id, request.id),
              isNull(paymentRequests.paidAt),
            ),
          )
          .for('update');
        if (!open) {
          return 'already-paid' as const;
        }
        await rethrowUniqueViolation(
          tx.insert(payments).values({
            groupId: request.groupId,
            fromMemberId: request.debtorMemberId,
            toMemberId: request.requesterMemberId,
            amountCents: payment.amountCents,
            token: request.token,
            signature: payment.signature,
            requestId: request.id,
            createdAt: at,
          }),
        );
        await tx
          .update(paymentRequests)
          .set({ paidAt: at, lastCheckedAt: at })
          .where(eq(paymentRequests.id, request.id));
        await tx
          .update(groups)
          .set({ lastActivityAt: at })
          .where(eq(groups.id, request.groupId));
        return 'recorded' as const;
      });
    } catch (error) {
      if (error instanceof UniqueViolationError) {
        return 'signature-used';
      }
      throw error;
    }
  }

  async cancelRequest(
    groupId: string,
    requesterMemberId: string,
    code: string,
    at: Date,
  ): Promise<CancelRequestResult> {
    const cancelled = await this.db
      .update(paymentRequests)
      .set({ replacedAt: at, cancelledAt: at })
      .where(
        and(
          eq(paymentRequests.groupId, groupId),
          eq(paymentRequests.requesterMemberId, requesterMemberId),
          eq(paymentRequests.code, code),
          isActive,
        ),
      )
      .returning({ id: paymentRequests.id });
    if (cancelled.length > 0) {
      return 'cancelled';
    }
    const [existing] = await this.db
      .select({ paidAt: paymentRequests.paidAt })
      .from(paymentRequests)
      .where(
        and(
          eq(paymentRequests.groupId, groupId),
          eq(paymentRequests.requesterMemberId, requesterMemberId),
          eq(paymentRequests.code, code),
        ),
      );
    return existing?.paidAt ? 'paid' : 'not-found';
  }

  async markReminded(
    groupId: string,
    requesterMemberId: string,
    code: string,
    at: Date,
    minIntervalMs: number,
  ): Promise<RemindResult> {
    const threshold = new Date(at.getTime() - minIntervalMs);
    const own = and(
      eq(paymentRequests.groupId, groupId),
      eq(paymentRequests.requesterMemberId, requesterMemberId),
      eq(paymentRequests.code, code),
    );
    const updated = await this.db
      .update(paymentRequests)
      .set({ lastRemindedAt: at })
      .where(
        and(
          own,
          isActive,
          gt(paymentRequests.expiresAt, at),
          or(
            isNull(paymentRequests.lastRemindedAt),
            sql`${paymentRequests.lastRemindedAt} <= ${threshold}`,
          ),
        ),
      )
      .returning({ id: paymentRequests.id });
    const [request] = await this.details().where(own);
    if (!request) {
      return { ok: false, reason: 'not-found' };
    }
    if (updated.length > 0) {
      return { ok: true, request };
    }
    if (
      request.paidAt ||
      request.replacedAt ||
      request.expiresAt <= at ||
      !request.lastRemindedAt
    ) {
      return { ok: false, reason: 'not-open' };
    }
    return {
      ok: false,
      reason: 'too-soon',
      nextAt: new Date(request.lastRemindedAt.getTime() + minIntervalMs),
    };
  }

  async recordCash(input: {
    groupId: string;
    userId: string;
    debtorMemberId: string;
    amountCents: number;
    at: Date;
  }): Promise<RecordCashResult> {
    return this.db.transaction(async (tx) => {
      // Блокировка группы: долг не изменится, пока проверяем и записываем
      const [me] = await tx
        .select({ id: groupMembers.id })
        .from(groups)
        .innerJoin(
          groupMembers,
          and(
            eq(groupMembers.groupId, groups.id),
            eq(groupMembers.userId, input.userId),
          ),
        )
        .where(eq(groups.id, input.groupId))
        .for('update', { of: groups });
      if (!me) {
        return { ok: false, reason: 'not-member' } as const;
      }
      const [debtor] = await tx
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, input.groupId),
            eq(groupMembers.id, input.debtorMemberId),
            isNull(groupMembers.leftAt),
          ),
        );
      if (!debtor || debtor.id === me.id) {
        return { ok: false, reason: 'foreign-member' } as const;
      }
      const ledgers = await loadDebtTotals(tx, [input.groupId]);
      const owed =
        debtsOf(
          netDebts(ledgers.get(input.groupId)?.totals ?? []),
          me.id,
        ).debts.find((debt) => debt.fromId === debtor.id && debt.toId === me.id)
          ?.cents ?? 0;
      if (owed === 0) {
        return { ok: false, reason: 'no-debt' } as const;
      }
      if (input.amountCents > owed) {
        return { ok: false, reason: 'too-much', owedCents: owed } as const;
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
            eq(paymentRequests.requesterMemberId, me.id),
            eq(paymentRequests.debtorMemberId, debtor.id),
            isActive,
          ),
        )
        .for('update');
      const closesRequest = open && input.amountCents >= open.amountCents;
      await tx.insert(payments).values({
        groupId: input.groupId,
        fromMemberId: debtor.id,
        toMemberId: me.id,
        amountCents: input.amountCents,
        method: 'cash',
        token: null,
        signature: null,
        recordedBy: input.userId,
        requestId: closesRequest ? open.id : null,
        createdAt: input.at,
      });
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
        .update(groups)
        .set({ lastActivityAt: input.at })
        .where(eq(groups.id, input.groupId));
      return {
        ok: true,
        remainingCents: owed - input.amountCents,
        closedRequest: Boolean(open),
      } as const;
    });
  }
}
