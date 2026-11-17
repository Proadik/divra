import { Controller, Get, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { UsersRepository } from './repositories/users.repository.js';
import type { UserProfile } from './user.interface.js';

/** Без @Public(): глобальный guard @nestjs/authentication требует валидный access-токен */
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersRepository) {}

  @Get()
  async me(@CurrentUser('id') id: string): Promise<UserProfile> {
    const profile = await this.users.getProfile(id);
    if (!profile) {
      throw new NotFoundException('Пользователь не найден');
    }
    return profile;
  }
}
