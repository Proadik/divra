import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  Public,
  RefreshTokenError,
  TokenService,
} from '@nestjs/authentication';
import { Throttle, minutes } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import {
  type ChallengeRequest,
  type VerifyRequest,
  challengeRequestSchema,
  verifyRequestSchema,
} from './auth.schemas.js';
import { BrowserRequestGuard } from './browser-request.guard.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie.js';
import {
  type IssuedChallenge,
  WalletAuthService,
} from './wallet-auth.service.js';

interface AccessTokenResponse {
  tokenType: 'Bearer';
  accessToken: string;
  /** Секунды до истечения access-токена */
  expiresIn: number;
}

/**
 * Вход кошельком и обновление токенов. Все маршруты публичные (токена ещё нет),
 * но принимают запросы только от нашего фронтенда (BrowserRequestGuard) и с лимитами.
 * Ответы с токенами не кэшируются.
 */
@Public()
@UseGuards(BrowserRequestGuard)
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly walletAuth: WalletAuthService,
    private readonly tokens: TokenService,
  ) {}

  @Post('wallet/challenge')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  challenge(
    @Body({ schema: challengeRequestSchema }) body: ChallengeRequest,
  ): Promise<IssuedChallenge> {
    return this.walletAuth.createChallenge(body);
  }

  /** Access-токен — в ответе (клиент держит его в памяти), refresh — только в HttpOnly-cookie */
  @Post('wallet/verify')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  async verify(
    @Body({ schema: verifyRequestSchema }) body: VerifyRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<
    AccessTokenResponse & {
      user: { id: string; chain: 'solana'; address: string; created: boolean };
    }
  > {
    const { user, tokens } = await this.walletAuth.verify(body);
    setRefreshCookie(response, this.config, tokens.refreshToken);
    return {
      tokenType: 'Bearer',
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      user,
    };
  }

  /**
   * Ротация: старый refresh-токен тратится, приходит новый. Повторное предъявление
   * потраченного токена (его украли) отзывает всё семейство — выходят и вор, и владелец.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: minutes(1) } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    const current = readRefreshCookie(request, this.config);
    if (!current) {
      throw new UnauthorizedException('Сессии нет — войди заново');
    }
    try {
      const next = await this.tokens.refresh(current);
      setRefreshCookie(response, this.config, next.refreshToken);
      return {
        tokenType: 'Bearer',
        accessToken: next.accessToken,
        expiresIn: next.expiresIn,
      };
    } catch (error) {
      if (error instanceof RefreshTokenError) {
        clearRefreshCookie(response, this.config);
        throw new UnauthorizedException('Сессия истекла — войди заново');
      }
      throw error;
    }
  }

  /** Выход с этого устройства: отзывает семейство refresh-токена. Неизвестный токен — тоже 204 (RFC 7009). */
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: minutes(1) } })
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const current = readRefreshCookie(request, this.config);
    if (current) {
      await this.tokens.revoke(current);
    }
    clearRefreshCookie(response, this.config);
  }
}
