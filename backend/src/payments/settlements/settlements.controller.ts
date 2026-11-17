import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Throttle, minutes } from '@nestjs/throttler';
import type { Stablecoin } from '../../database/schema/index.js';
import { UsersRepository } from '../../users/repositories/users.repository.js';
import { BalanceReader } from '../solana/balance-reader.js';
import { RAW_UNITS_PER_CENT, stablecoinMint } from '../solana/stablecoins.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import {
  type PrepareSettlement,
  type SubmitSettlement,
  prepareSettlementSchema,
  submitSettlementSchema,
} from './settlements.schemas.js';
import {
  type PreparedSettlement,
  type SettlementResult,
  SettlementsService,
} from './settlements.service.js';

const uuid = (message: string) =>
  new ParseUUIDPipe({
    version: '4',
    exceptionFactory: () => new NotFoundException(message),
  });

@Controller('groups/:groupId/settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  prepare(
    @CurrentUser('id') userId: string,
    @Param('groupId', uuid('Группа не найдена')) groupId: string,
    @Body({ schema: prepareSettlementSchema }) body: PrepareSettlement,
  ): Promise<PreparedSettlement> {
    return this.settlements.prepare(groupId, userId, body);
  }

  @Post(':settlementId/submit')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  submit(
    @CurrentUser('id') userId: string,
    @Param('groupId', uuid('Группа не найдена')) groupId: string,
    @Param('settlementId', uuid('Расчёт не найден')) settlementId: string,
    @Body({ schema: submitSettlementSchema }) body: SubmitSettlement,
  ): Promise<SettlementResult> {
    if (body.settlementId !== settlementId) {
      throw new NotFoundException('Расчёт не найден');
    }
    return this.settlements.submit(
      groupId,
      userId,
      settlementId,
      body.signedTransaction,
    );
  }
}

/** Балансы стейблкоинов своего кошелька — чтобы заранее сказать «не хватает USDC» */
@Controller('wallets')
export class WalletsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersRepository,
    private readonly balances: BalanceReader,
  ) {}

  @Get(':address/balances')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: minutes(1) } })
  async balancesOf(
    @CurrentUser('id') userId: string,
    @Param('address') walletAddress: string,
  ): Promise<Record<Stablecoin, number>> {
    // Только свои кошельки: эндпоинт не должен быть открытым прокси к RPC
    const profile = await this.users.getProfile(userId);
    const own = profile?.wallets.some(
      (wallet) => wallet.chain === 'solana' && wallet.address === walletAddress,
    );
    if (!own) {
      throw new NotFoundException('Кошелёк не найден');
    }
    const read = async (coin: Stablecoin): Promise<number> => {
      const mint = stablecoinMint(this.config.SOLANA_CLUSTER, coin);
      if (!mint) {
        return 0;
      }
      const raw = await this.balances.balanceOf(walletAddress, mint);
      return Number(raw / RAW_UNITS_PER_CENT) / 100;
    };
    const [USDC, USDT] = await Promise.all([read('USDC'), read('USDT')]);
    return { USDC, USDT };
  }
}
