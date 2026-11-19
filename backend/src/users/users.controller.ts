import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Patch,
  Res,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, TokenService } from '@nestjs/authentication';
import { Throttle, minutes } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { BrowserRequestGuard } from '../auth/browser-request.guard.js';
import { clearRefreshCookie } from '../auth/refresh-cookie.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { humanText } from '../groups/groups.schemas.js';
import { DomainEvents } from '../events/domain-events.js';
import { UsersRepository } from './repositories/users.repository.js';
import type { UserProfile } from './user.interface.js';

const updateProfileSchema = z
  .strictObject({
    displayName: humanText(32, 'Введи имя').optional(),
    /** Замечать переводы на мой кошелёк от участников общих групп, сделанные мимо Divra */
    detectTransfers: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.displayName !== undefined || value.detectTransfers !== undefined,
    'Нечего менять',
  );

const userNotFound = (): NotFoundException =>
  new NotFoundException('Пользователь не найден');

/** Без @Public(): глобальный guard @nestjs/authentication требует валидный access-токен */
@Controller('me')
export class UsersController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersRepository,
    private readonly tokens: TokenService,
    private readonly events: DomainEvents,
  ) {}

  @Get()
  async me(@CurrentUser('id') id: string): Promise<UserProfile> {
    const profile = await this.users.getProfile(id);
    if (!profile) {
      throw userNotFound();
    }
    return profile;
  }

  /**
   * Имя профиля (заменяет и имя по умолчанию — короткий адрес — в твоих группах)
   * и настройка «замечать переводы мимо Divra»
   */
  @Patch()
  @Throttle({ default: { limit: 20, ttl: minutes(1) } })
  async update(
    @CurrentUser('id') id: string,
    @Body({ schema: updateProfileSchema })
    body: z.infer<typeof updateProfileSchema>,
  ): Promise<UserProfile> {
    if (body.displayName !== undefined) {
      if (!(await this.users.updateDisplayName(id, body.displayName))) {
        throw userNotFound();
      }
    }
    if (body.detectTransfers !== undefined) {
      if (!(await this.users.setDetectTransfers(id, body.detectTransfers))) {
        throw userNotFound();
      }
      // Подписка на переводы пересоберётся без этого кошелька (или с ним)
      this.events.emit({ type: 'membership.changed' });
    }
    const profile = await this.users.getProfile(id);
    if (!profile) {
      throw userNotFound();
    }
    return profile;
  }

  /**
   * Удалить аккаунт: кошельки и все сессии. В группах остаётся участник без кошелька с тем же
   * именем. Только с нашего фронтенда — заодно стирается refresh-cookie.
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(BrowserRequestGuard)
  @Throttle({ default: { limit: 5, ttl: minutes(1) } })
  async remove(
    @CurrentUser('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (!(await this.users.deleteUser(id))) {
      throw userNotFound();
    }
    // Refresh-токены не связаны с users внешним ключом — отзываем явно
    await this.tokens.revokeAll(id);
    this.events.emit({ type: 'membership.changed' });
    clearRefreshCookie(response, this.config);
  }
}
