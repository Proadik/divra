import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { aliasedTable, and, count, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import {
  groupMembers,
  groups,
  invites,
  users,
  walletAccounts,
} from '../database/schema/index.js';
import { shortAddress } from '../groups/initials.js';
import {
  MAX_GROUPS_PER_USER,
  MAX_MEMBERS_PER_GROUP,
} from '../groups/repositories/groups.repository.js';

export interface InviteRecord {
  code: string;
  groupId: string;
  claimMemberId: string | null;
  expiresAt: Date;
}

export interface InvitePreviewRecord extends InviteRecord {
  groupName: string;
  inviterName: string;
  claimMemberName: string | null;
  claimedAt: Date | null;
  membersCount: number;
}

export type CreateInviteResult =
  | { ok: true; invite: InviteRecord }
  | { ok: false; reason: 'not-member' | 'claim-unavailable' };

export type AcceptInviteResult =
  | { ok: true; groupId: string; memberId: string; alreadyMember: boolean }
  | {
      ok: false;
      reason:
        'not-found' | 'expired' | 'claimed' | 'member-limit' | 'group-limit';
    };

const inviteColumns = {
  code: invites.code,
  groupId: invites.groupId,
  claimMemberId: invites.claimMemberId,
  expiresAt: invites.expiresAt,
};

/** Имя, которого ещё нет в группе: «Ccrt…KY47», при совпадении — «Ccrt…KY47 2» */
const freeName = (base: string, taken: ReadonlySet<string>): string => {
  for (let index = 1; index < 100; index += 1) {
    const candidate = index === 1 ? base : `${base.slice(0, 28)} ${index}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${base.slice(0, 22)} ${Date.now() % 1_000_000}`;
};

@Injectable()
export class InvitesRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async create(input: {
    groupId: string;
    userId: string;
    claimMemberId: string | null;
    code: string;
    expiresAt: Date;
  }): Promise<CreateInviteResult> {
    return this.db.transaction(async (tx) => {
      const [inviter] = await tx
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, input.groupId),
            eq(groupMembers.userId, input.userId),
          ),
        );
      if (!inviter) {
        return { ok: false, reason: 'not-member' } as const;
      }
      if (input.claimMemberId) {
        // Персональная ссылка — только на участника этой группы без кошелька
        const [claim] = await tx
          .select({ id: groupMembers.id })
          .from(groupMembers)
          .where(
            and(
              eq(groupMembers.id, input.claimMemberId),
              eq(groupMembers.groupId, input.groupId),
              isNull(groupMembers.userId),
            ),
          );
        if (!claim) {
          return { ok: false, reason: 'claim-unavailable' } as const;
        }
      }
      const [invite] = await tx
        .insert(invites)
        .values({
          code: input.code,
          groupId: input.groupId,
          createdBy: input.userId,
          inviterMemberId: inviter.id,
          claimMemberId: input.claimMemberId,
          expiresAt: input.expiresAt,
        })
        .returning(inviteColumns);
      if (!invite) {
        throw new Error('Приглашение не создано');
      }
      return { ok: true, invite } as const;
    });
  }

  async preview(code: string): Promise<InvitePreviewRecord | undefined> {
    const inviter = aliasedTable(groupMembers, 'inviter');
    const claim = aliasedTable(groupMembers, 'claim');
    const [row] = await this.db
      .select({
        ...inviteColumns,
        claimedAt: invites.claimedAt,
        groupName: groups.name,
        inviterName: inviter.displayName,
        claimMemberName: claim.displayName,
        membersCount:
          sql<number>`(select count(*) from ${groupMembers} where ${groupMembers.groupId} = ${invites.groupId})`.mapWith(
            Number,
          ),
      })
      .from(invites)
      .innerJoin(groups, eq(groups.id, invites.groupId))
      .innerJoin(inviter, eq(inviter.id, invites.inviterMemberId))
      .leftJoin(claim, eq(claim.id, invites.claimMemberId))
      .where(eq(invites.code, code));
    return row;
  }

  /**
   * Вход в группу по ссылке. Всё в одной транзакции под блокировками приглашения, группы
   * и пользователя: персонального участника не заберут двое, лимиты не обойти параллельно.
   */
  async accept(
    code: string,
    userId: string,
    now: Date,
  ): Promise<AcceptInviteResult> {
    return this.db.transaction(async (tx) => {
      const [invite] = await tx
        .select({
          id: invites.id,
          groupId: invites.groupId,
          claimMemberId: invites.claimMemberId,
          expiresAt: invites.expiresAt,
          claimedAt: invites.claimedAt,
        })
        .from(invites)
        .where(eq(invites.code, code))
        .for('update');
      if (!invite) {
        return { ok: false, reason: 'not-found' } as const;
      }
      await tx
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.id, invite.groupId))
        .for('update');

      // Уже в группе — ничего не меняем (персональная ссылка остаётся неиспользованной)
      const [existing] = await tx
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, invite.groupId),
            eq(groupMembers.userId, userId),
          ),
        );
      if (existing) {
        return {
          ok: true,
          groupId: invite.groupId,
          memberId: existing.id,
          alreadyMember: true,
        } as const;
      }
      if (invite.expiresAt <= now) {
        return { ok: false, reason: 'expired' } as const;
      }
      if (invite.claimMemberId && invite.claimedAt) {
        return { ok: false, reason: 'claimed' } as const;
      }

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
        return { ok: false, reason: 'group-limit' } as const;
      }

      let memberId: string;
      if (invite.claimMemberId) {
        // Забираем участника без кошелька: его расходы и долги становятся твоими
        const [claimed] = await tx
          .update(groupMembers)
          .set({ userId, joinedAt: now })
          .where(
            and(
              eq(groupMembers.id, invite.claimMemberId),
              eq(groupMembers.groupId, invite.groupId),
              isNull(groupMembers.userId),
            ),
          )
          .returning({ id: groupMembers.id });
        if (!claimed) {
          return { ok: false, reason: 'claimed' } as const;
        }
        memberId = claimed.id;
        await tx
          .update(invites)
          .set({ claimedAt: now, uses: sql`${invites.uses} + 1` })
          .where(eq(invites.id, invite.id));
      } else {
        const names = await tx
          .select({ name: groupMembers.displayName })
          .from(groupMembers)
          .where(eq(groupMembers.groupId, invite.groupId));
        if (names.length >= MAX_MEMBERS_PER_GROUP) {
          return { ok: false, reason: 'member-limit' } as const;
        }
        const [wallet] = await tx
          .select({ address: walletAccounts.address })
          .from(walletAccounts)
          .where(
            and(
              eq(walletAccounts.userId, userId),
              eq(walletAccounts.chain, 'solana'),
            ),
          )
          .orderBy(walletAccounts.createdAt)
          .limit(1);
        const base =
          user.displayName ??
          (wallet ? shortAddress(wallet.address) : 'Участник');
        const [created] = await tx
          .insert(groupMembers)
          .values({
            groupId: invite.groupId,
            userId,
            displayName: freeName(
              base.slice(0, 32),
              new Set(names.map((item) => item.name.toLowerCase())),
            ),
            joinedAt: now,
          })
          .returning({ id: groupMembers.id });
        if (!created) {
          throw new Error('Участник не добавлен');
        }
        memberId = created.id;
        await tx
          .update(invites)
          .set({ uses: sql`${invites.uses} + 1` })
          .where(eq(invites.id, invite.id));
      }
      return {
        ok: true,
        groupId: invite.groupId,
        memberId,
        alreadyMember: false,
      } as const;
    });
  }
}
