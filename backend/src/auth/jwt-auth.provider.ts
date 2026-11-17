import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  JwtBearerProvider,
  type JwtClaims,
} from '@nestjs/authentication';
import { UsersRepository } from '../users/repositories/users.repository.js';
import type { AuthUser } from '../users/user.interface.js';

/**
 * `Authorization: Bearer <jwt>`: подпись, exp, iss и aud проверяет @nestjs/authentication
 * (ключ и параметры — из accessToken в AuthenticationModule). Здесь — только что пользователь
 * ещё существует: удалённый пользователь с живым токеном получает 401.
 */
@Injectable()
export class JwtAuthProvider extends JwtBearerProvider<AuthUser> {
  constructor(
    private readonly users: UsersRepository,
    registry: AuthenticationRegistry,
  ) {
    super({ realm: 'divra' });
    registry.registerProvider(this);
  }

  protected async validate({ sub }: JwtClaims): Promise<AuthUser | null> {
    return sub ? ((await this.users.findById(sub)) ?? null) : null;
  }
}
