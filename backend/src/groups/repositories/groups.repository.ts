import type { GroupKind } from '../../database/schema/index.js';

export interface GroupRecord {
  id: string;
  name: string;
  kind: GroupKind;
  createdAt: Date;
  lastActivityAt: Date;
}

export interface MemberRecord {
  id: string;
  userId: string | null;
  displayName: string;
  /** Solana-адрес активного участника (самый ранний кошелёк); у pending — null */
  address: string | null;
}

export type CreateGroupResult =
  | {
      ok: true;
      group: GroupRecord & { membersCount: number; myMemberId: string };
    }
  | { ok: false; reason: 'group-limit' };

export type AddMemberResult =
  | { ok: true; member: MemberRecord }
  | { ok: false; reason: 'not-member' | 'member-limit' | 'duplicate-name' };

export type RemoveMemberResult =
  | { ok: true; left: boolean }
  | {
      ok: false;
      reason: 'not-member' | 'not-found' | 'has-wallet' | 'has-debts';
    };

/** Сколько групп может быть у одного пользователя и участников в одной группе */
export const MAX_GROUPS_PER_USER = 100;
export const MAX_MEMBERS_PER_GROUP = 50;

export abstract class GroupsRepository {
  /** Группы, где пользователь — участник, с числом участников, новые сверху */
  abstract listForUser(
    userId: string,
  ): Promise<Array<GroupRecord & { membersCount: number; myMemberId: string }>>;

  /** Новая группа; создатель становится её первым активным участником */
  abstract create(
    userId: string,
    input: { name: string; kind: GroupKind },
  ): Promise<CreateGroupResult>;

  /** Группа и её участники — только если userId в ней состоит. Иначе undefined */
  abstract findForMember(
    groupId: string,
    userId: string,
  ): Promise<{ group: GroupRecord; members: MemberRecord[] } | undefined>;

  /**
   * Выйти из группы (memberId — свой) или удалить участника без кошелька. Только если у него
   * нет долгов ни перед кем и ему никто не должен. Строка участника остаётся с left_at:
   * на неё ссылаются старые расходы. Его открытые запросы оплаты и персональные
   * приглашения на него закрываются.
   */
  abstract removeMember(
    groupId: string,
    userId: string,
    memberId: string,
  ): Promise<RemoveMemberResult>;

  /** Участник по имени, без кошелька. Добавлять может любой участник группы */
  abstract addPendingMember(
    groupId: string,
    userId: string,
    displayName: string,
  ): Promise<AddMemberResult>;
}
