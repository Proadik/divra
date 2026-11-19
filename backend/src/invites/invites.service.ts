import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import {
  MAX_GROUPS_PER_USER,
  MAX_MEMBERS_PER_GROUP,
} from '../groups/repositories/groups.repository.js';
import { InvitesRepository } from './invites.repository.js';
import { DomainEvents } from '../events/domain-events.js';

/** Сколько живёт ссылка-приглашение */
const INVITE_TTL_MS = 7 * 24 * 3_600_000;
/** 16 случайных байт в base64url */
const INVITE_CODE = /^[\w-]{22}$/;

const inviteNotFound = (): NotFoundException =>
  new NotFoundException('Приглашение не найдено');

/** Контракт — frontend/src/shared/api/groups/members-schemas.ts */
export interface InviteView {
  code: string;
  url: string;
  expiresAt: string;
  claimMemberId: string | null;
}

export interface ActiveInviteView extends InviteView {
  invitedByName: string;
  claimMemberName: string | null;
  uses: number;
  createdAt: string;
}

export interface InvitePreview {
  code: string;
  groupId: string;
  groupName: string;
  invitedByName: string;
  membersCount: number;
  claimMemberName: string | null;
  expiresAt: string;
}

@Injectable()
export class InvitesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly repository: InvitesRepository,
    private readonly events: DomainEvents,
  ) {}

  async create(
    groupId: string,
    userId: string,
    claimMemberId: string | null,
  ): Promise<InviteView> {
    const result = await this.repository.create({
      groupId,
      userId,
      claimMemberId,
      code: randomBytes(16).toString('base64url'),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    if (!result.ok) {
      if (result.reason === 'not-member') {
        throw new NotFoundException('Группа не найдена');
      }
      throw new ConflictException('Этот участник уже подключил кошелёк');
    }
    return {
      code: result.invite.code,
      url: this.urlOf(result.invite.code),
      expiresAt: result.invite.expiresAt.toISOString(),
      claimMemberId: result.invite.claimMemberId,
    };
  }

  /** Что видно по ссылке до входа: группа, кто пригласил, сколько участников */
  async preview(code: string): Promise<InvitePreview> {
    if (!INVITE_CODE.test(code)) {
      throw inviteNotFound();
    }
    const invite = await this.repository.preview(code);
    if (!invite) {
      throw inviteNotFound();
    }
    if (invite.revokedAt) {
      throw new GoneException('Приглашение отозвано');
    }
    if (invite.expiresAt <= new Date()) {
      throw new GoneException('Срок приглашения истёк');
    }
    if (invite.claimMemberId && invite.claimedAt) {
      throw new GoneException('Приглашение уже использовано');
    }
    return {
      code: invite.code,
      groupId: invite.groupId,
      groupName: invite.groupName,
      invitedByName: invite.inviterName,
      membersCount: invite.membersCount,
      claimMemberName: invite.claimMemberName,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async accept(
    code: string,
    userId: string,
  ): Promise<{ groupId: string; memberId: string; alreadyMember: boolean }> {
    if (!INVITE_CODE.test(code)) {
      throw inviteNotFound();
    }
    const result = await this.repository.accept(code, userId, new Date());
    if (result.ok) {
      if (!result.alreadyMember) {
        this.events.emit({ type: 'group.changed', groupId: result.groupId });
        this.events.emit({ type: 'membership.changed' });
      }
      return {
        groupId: result.groupId,
        memberId: result.memberId,
        alreadyMember: result.alreadyMember,
      };
    }
    switch (result.reason) {
      case 'not-found':
        throw inviteNotFound();
      case 'expired':
        throw new GoneException('Срок приглашения истёк');
      case 'claimed':
        throw new GoneException('Приглашение уже использовано');
      case 'revoked':
        throw new GoneException('Приглашение отозвано');
      case 'member-limit':
        throw new UnprocessableEntityException(
          `В группе уже ${MAX_MEMBERS_PER_GROUP} участников`,
        );
      case 'group-limit':
        throw new UnprocessableEntityException(
          `Не больше ${MAX_GROUPS_PER_USER} групп`,
        );
    }
  }

  async listActive(
    groupId: string,
    userId: string,
  ): Promise<ActiveInviteView[]> {
    const rows = await this.repository.listActive(groupId, userId, new Date());
    if (!rows) {
      throw new NotFoundException('Группа не найдена');
    }
    return rows.map((row) => ({
      code: row.code,
      url: this.urlOf(row.code),
      expiresAt: row.expiresAt.toISOString(),
      claimMemberId: row.claimMemberId,
      invitedByName: row.inviterName,
      claimMemberName: row.claimMemberName,
      uses: row.uses,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async revoke(groupId: string, code: string, userId: string): Promise<void> {
    if (
      !INVITE_CODE.test(code) ||
      !(await this.repository.revoke(groupId, code, userId, new Date()))
    ) {
      throw inviteNotFound();
    }
  }

  private urlOf(code: string): string {
    return `${this.config.APP_ORIGIN}/join/${code}`;
  }
}
