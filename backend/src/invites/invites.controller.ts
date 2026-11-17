import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser, Public } from '@nestjs/authentication';
import { Throttle, minutes } from '@nestjs/throttler';
import { z } from 'zod';
import {
  type InvitePreview,
  type InviteView,
  InvitesService,
} from './invites.service.js';

const groupIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () => new NotFoundException('Группа не найдена'),
});

const createInviteSchema = z.strictObject({
  /** Персональная ссылка: кто войдёт, «заберёт» этого участника без кошелька */
  claimMemberId: z.uuid().optional(),
});

@Controller('groups/:groupId/invites')
export class GroupInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: minutes(1) } })
  create(
    @CurrentUser('id') userId: string,
    @Param('groupId', groupIdPipe) groupId: string,
    @Body({ schema: createInviteSchema })
    body: z.infer<typeof createInviteSchema>,
  ): Promise<InviteView> {
    return this.invites.create(groupId, userId, body.claimMemberId ?? null);
  }
}

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /** Превью по ссылке — до входа. Код 128-битный, перебором не найти; лимит страхует */
  @Public()
  @Get(':code')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: minutes(1) } })
  preview(@Param('code') code: string): Promise<InvitePreview> {
    return this.invites.preview(code);
  }

  /** Войти в группу — только с подтверждённым кошельком (access-токен) */
  @Post(':code/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: minutes(1) } })
  accept(
    @CurrentUser('id') userId: string,
    @Param('code') code: string,
  ): Promise<{ groupId: string; memberId: string; alreadyMember: boolean }> {
    return this.invites.accept(code, userId);
  }
}
