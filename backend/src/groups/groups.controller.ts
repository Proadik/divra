import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Throttle, minutes } from '@nestjs/throttler';
import type {
  ExpenseDetailView,
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

const expenseIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () => new NotFoundException('Расход не найден'),
});

const memberIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () => new NotFoundException('Участник не найден'),
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

  @Get(':groupId/expenses/:expenseId')
  expense(
    @CurrentUser('id') userId: string,
    @Param('groupId', groupIdPipe) groupId: string,
    @Param('expenseId', expenseIdPipe) expenseId: string,
  ): Promise<ExpenseDetailView> {
    return this.groups.expense(groupId, expenseId, userId);
  }

  /** Заменить расход целиком: тело как при создании. Только автор или плательщик */
  @Put(':groupId/expenses/:expenseId')
  @Throttle({ default: { limit: 60, ttl: minutes(1) } })
  updateExpense(
    @CurrentUser('id') userId: string,
    @Param('groupId', groupIdPipe) groupId: string,
    @Param('expenseId', expenseIdPipe) expenseId: string,
    @Body({ schema: createExpenseRequestSchema }) body: CreateExpenseRequest,
  ): Promise<ExpenseView> {
    return this.groups.updateExpense(groupId, expenseId, userId, body);
  }

  @Delete(':groupId/expenses/:expenseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 60, ttl: minutes(1) } })
  deleteExpense(
    @CurrentUser('id') userId: string,
    @Param('groupId', groupIdPipe) groupId: string,
    @Param('expenseId', expenseIdPipe) expenseId: string,
  ): Promise<void> {
    return this.groups.deleteExpense(groupId, expenseId, userId);
  }

  /** Свой memberId — выйти из группы; чужой — удалить участника без кошелька. Только без долгов */
  @Delete(':groupId/members/:memberId')
  @Throttle({ default: { limit: 30, ttl: minutes(1) } })
  removeMember(
    @CurrentUser('id') userId: string,
    @Param('groupId', groupIdPipe) groupId: string,
    @Param('memberId', memberIdPipe) memberId: string,
  ): Promise<{ left: boolean }> {
    return this.groups.removeMember(groupId, memberId, userId);
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
