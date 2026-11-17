import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Throttle, minutes } from '@nestjs/throttler';
import type {
  ExpenseView,
  GroupMemberView,
  GroupOverview,
  GroupSummary,
  HomeOverview,
} from './group.interface.js';
import {
  type AddMemberRequest,
  type CreateExpenseRequest,
  type CreateGroupRequest,
  addMemberRequestSchema,
  createExpenseRequestSchema,
  createGroupRequestSchema,
} from './groups.schemas.js';
import { GroupsService } from './groups.service.js';

/** Невалидный id — тот же 404, что и чужая группа: не подсказываем, что формат неверный */
const groupIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () => new NotFoundException('Группа не найдена'),
});

/**
 * Все маршруты — только с access-токеном (глобальный guard).
 * Токен в заголовке Authorization, не в cookie, поэтому CSRF здесь не применим.
 */
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: minutes(1) } })
  create(
    @CurrentUser('id') userId: string,
    @Body({ schema: createGroupRequestSchema }) body: CreateGroupRequest,
  ): Promise<GroupSummary> {
    return this.groups.create(userId, body);
  }

  @Get(':groupId/overview')
  overview(
    @CurrentUser('id') userId: string,
    @Param('groupId', groupIdPipe) groupId: string,
  ): Promise<GroupOverview> {
    return this.groups.overview(groupId, userId);
  }

  @Post(':groupId/members')
  @Throttle({ default: { limit: 30, ttl: minutes(1) } })
  addMember(
    @CurrentUser('id') userId: string,
    @Param('groupId', groupIdPipe) groupId: string,
    @Body({ schema: addMemberRequestSchema }) body: AddMemberRequest,
  ): Promise<GroupMemberView> {
    return this.groups.addMember(groupId, userId, body);
  }

  @Post(':groupId/expenses')
  @Throttle({ default: { limit: 60, ttl: minutes(1) } })
  createExpense(
    @CurrentUser('id') userId: string,
    @Param('groupId', groupIdPipe) groupId: string,
    @Body({ schema: createExpenseRequestSchema }) body: CreateExpenseRequest,
  ): Promise<ExpenseView> {
    return this.groups.createExpense(groupId, userId, body);
  }
}

/** Главная: итог по всем группам пользователя */
@Controller('me')
export class OverviewController {
  constructor(private readonly groups: GroupsService) {}

  @Get('overview')
  overview(@CurrentUser('id') userId: string): Promise<HomeOverview> {
    return this.groups.home(userId);
  }
}
