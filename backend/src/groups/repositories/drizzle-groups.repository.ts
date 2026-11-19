import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  or,
} from 'drizzle-orm';
import type {
  Database,
  DatabaseExecutor,
} from '../../database/database.module.js';
import {
  groupMembers,
  groups,
  invites,
  paymentRequests,
  users,
  walletAccounts,
} from '../../database/schema/index.js';
import { debtsOf, netDebts } from '../ledger.js';
import { loadDebtTotals } from './drizzle-expenses.repository.js';
import { rethrowUniqueViolation } from '../../database/unique-violation.js';
import { UniqueViolationError } from '../../common/errors/unique-violation.error.js';
import { shortAddress } from '../initials.js';
import {
  type AddMemberResult,
  type CreateGroupResult,
  type GroupRecord,
  GroupsRepository,
  MAX_GROUPS_PER_USER,
  MAX_MEMBERS_PER_GROUP,
  type MemberRecord,
  type RemoveMemberResult,
} from './groups.repository.js';

const groupColumns = {
  id: groups.id,
  name: groups.name,
  kind: groups.kind,
  createdAt: groups.createdAt,
  lastActivityAt: groups.lastActivityAt,
};

@Injectable()
export class DrizzleGroupsRepository extends GroupsRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {
    super();
  }

  async listForUser(
    userId: string,
  ): Promise<
    Array<GroupRecord & { membersCount: number; myMemberId: string }>
  > {
    const me = aliasedTable(groupMembers, 'me');
    return this.db
      .select({
        ...groupColumns,
        myMemberId: me.id,
        membersCount: count(groupMembers.id),
      })
      .from(groups)
      .innerJoin(me, and(eq(me.groupId, groups.id), eq(me.userId, userId)))
      .innerJoin(
        groupMembers,
        and(eq(groupMembers.groupId, groups.id), isNull(groupMembers.leftAt)),
      )
      .groupBy(groups.id, me.id)
      .orderBy(desc(groups.lastActivityAt), desc(groups.createdAt));
  }

  async create(
    userId: string,
    input: { name: string; kind: GroupRecord['kind'] },
  ): Promise<CreateGroupResult> {
    return this.db.transaction(async (tx) => {
      // Блокировка строки пользователя: два параллельных запроса не обойдут лимит групп
      const [user] = await tx
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!user) {
        throw new Error('Пользователь не найден');
      }
      const [owned] = await tx
        .select({ value: count() })
        .from(groupMembers)
        .where(eq(groupMembers.userId, userId));
      if ((owned?.value ?? 0) >= MAX_GROUPS_PER_USER) {
        return { ok: false, reason: 'group-limit' };
      }

      const now = new Date();
      const [group] = await tx
        .insert(groups)
        .values({
          name: input.name,
          kind: input.kind,
          createdBy: userId,
          createdAt: now,
          lastActivityAt: now,
        })
        .returning(groupColumns);
      if (!group) {
        throw new Error('Группа не создана');
      }
      const address = await this.primaryAddress(tx, userId);
      const [member] = await tx
        .insert(groupMembers)
        .values({
          groupId: group.id,
          userId,
          displayName: (
            user.displayName ?? (address ? shortAddress(address) : 'Я')
          ).slice(0, 32),
          joinedAt: now,
        })
        .returning({ id: groupMembers.id });
      if (!member) {
        throw new Error('Участник не создан');
      }
      return {
        ok: true,
        group: { ...group, membersCount: 1, myMemberId: member.id },
      };
    });
  }

  async findForMember(
    groupId: string,
    userId: string,
  ): Promise<{ group: GroupRecord; members: MemberRecord[] } | undefined> {
    const [group] = await this.db
      .select(groupColumns)
      .from(groups)
      .innerJoin(
        groupMembers,
        and(
          eq(groupMembers.groupId, groups.id),
          eq(groupMembers.userId, userId),
        ),
      )
      .where(eq(groups.id, groupId));
    if (!group) {
      return undefined;
    }
    const rows = await this.db
      .select({
        id: groupMembers.id,
        userId: groupMembers.userId,
        displayName: groupMembers.displayName,
      })
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), isNull(groupMembers.leftAt)),
      )
      .orderBy(asc(groupMembers.createdAt), asc(groupMembers.id));
    const addresses = await this.addressesOf(
      rows.flatMap((row) => (row.userId ? [row.userId] : [])),
    );
    return {
      group,
      members: rows.map((row) => ({
        ...row,
        address: row.userId ? (addresses.get(row.userId) ?? null) : null,
      })),
    };
  }

  async addPendingMember(
    groupId: string,
    userId: string,
    displayName: string,
  ): Promise<AddMemberResult> {
    try {
      return await this.db.transaction(async (tx) => {
        // Блокировка группы: лимит участников не обойти параллельными запросами
        const [group] = await tx
          .select({ id: groups.id })
          .from(groups)
          .innerJoin(
            groupMembers,
            and(
              eq(groupMembers.groupId, groups.id),
              eq(groupMembers.userId, userId),
            ),
          )
          .where(eq(groups.id, groupId))
          .for('update', { of: groups });
        if (!group) {
          return { ok: false, reason: 'not-member' } as const;
        }
        const [members] = await tx
          .select({ value: count() })
          .from(groupMembers)
          .where(
            and(eq(groupMembers.groupId, groupId), isNull(groupMembers.leftAt)),
          );
        if ((members?.value ?? 0) >= MAX_MEMBERS_PER_GROUP) {
          return { ok: false, reason: 'member-limit' } as const;
        }
        const [member] = await rethrowUniqueViolation(
          tx
            .insert(groupMembers)
            .values({ groupId, displayName, addedBy: userId })
            .returning({
              id: groupMembers.id,
              userId: groupMembers.userId,
              displayName: groupMembers.displayName,
            }),
        );
        if (!member) {
          throw new Error('Участник не добавлен');
        }
        return { ok: true, member: { ...member, address: null } } as const;
      });
    } catch (error) {
      if (error instanceof UniqueViolationError) {
        return { ok: false, reason: 'duplicate-name' };
      }
      throw error;
    }
  }

  async removeMember(
    groupId: string,
    userId: string,
    memberId: string,
  ): Promise<RemoveMemberResult> {
    return this.db.transaction(async (tx) => {
      // Блокировка группы: пока проверяем долги, расходы в ней не появятся
      const [me] = await tx
        .select({ id: groupMembers.id })
        .from(groups)
        .innerJoin(
          groupMembers,
          and(
            eq(groupMembers.groupId, groups.id),
            eq(groupMembers.userId, userId),
          ),
        )
        .where(eq(groups.id, groupId))
        .for('update', { of: groups });
      if (!me) {
        return { ok: false, reason: 'not-member' } as const;
      }
      const [target] = await tx
        .select({ id: groupMembers.id, userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            eq(groupMembers.id, memberId),
            isNull(groupMembers.leftAt),
          ),
        )
        .for('update');
      if (!target) {
        return { ok: false, reason: 'not-found' } as const;
      }
      const leaving = target.id === me.id;
      // Участника с кошельком нельзя выгнать: он выходит только сам
      if (!leaving && target.userId) {
        return { ok: false, reason: 'has-wallet' } as const;
      }
      const ledgers = await loadDebtTotals(tx, [groupId]);
      const mine = debtsOf(
        netDebts(ledgers.get(groupId)?.totals ?? []),
        target.id,
      );
      if (mine.debts.length > 0) {
        return { ok: false, reason: 'has-debts' } as const;
      }

      const now = new Date();
      // user_id обнуляется: доступ к группе пропадает сразу, а повторно войти можно по ссылке
      await tx
        .update(groupMembers)
        .set({ leftAt: now, userId: null })
        .where(eq(groupMembers.id, target.id));
      await tx
        .update(paymentRequests)
        .set({ replacedAt: now, cancelledAt: now })
        .where(
          and(
            eq(paymentRequests.groupId, groupId),
            or(
              eq(paymentRequests.requesterMemberId, target.id),
              eq(paymentRequests.debtorMemberId, target.id),
            ),
            isNull(paymentRequests.paidAt),
            isNull(paymentRequests.replacedAt),
          ),
        );
      await tx
        .update(invites)
        .set({ revokedAt: now })
        .where(
          and(
            eq(invites.groupId, groupId),
            eq(invites.claimMemberId, target.id),
            isNull(invites.claimedAt),
            isNull(invites.revokedAt),
          ),
        );
      return { ok: true, left: leaving } as const;
    });
  }

  /** Самый ранний Solana-кошелёк пользователя — на него приходят переводы */
  private async primaryAddress(
    db: DatabaseExecutor,
    userId: string,
  ): Promise<string | null> {
    return (await this.addressesOf([userId], db)).get(userId) ?? null;
  }

  private async addressesOf(
    userIds: string[],
    db: DatabaseExecutor = this.db,
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .selectDistinctOn([walletAccounts.userId], {
        userId: walletAccounts.userId,
        address: walletAccounts.address,
      })
      .from(walletAccounts)
      .where(
        and(
          inArray(walletAccounts.userId, userIds),
          eq(walletAccounts.chain, 'solana'),
        ),
      )
      .orderBy(walletAccounts.userId, asc(walletAccounts.createdAt));
    return new Map(rows.map((row) => [row.userId, row.address]));
  }
}
