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
      url: `${this.config.APP_ORIGIN}/join/${result.invite.code}`,
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
}
