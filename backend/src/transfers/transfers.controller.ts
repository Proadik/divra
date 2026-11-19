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
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Throttle, minutes } from '@nestjs/throttler';
import { z } from 'zod';
import { type HistoryPageView, HistoryService } from './history.service.js';
import {
  type AppliedTransferView,
  type DetectedTransferView,
  TransfersService,
} from './transfers.service.js';

const transferIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () => new NotFoundException('Перевод не найден'),
});

const applySchema = z.strictObject({ groupId: z.uuid() });

const historyQuerySchema = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Подсказки «перевод мимо Divra» — только свои (тот, кто получил деньги) */
@Controller()
export class TransfersController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly history: HistoryService,
  ) {}

  /** «История»: переводы в сети с твоим участием, новые сверху, страницами по курсору */
  @Get('me/history')
  @Header('Cache-Control', 'no-store')
  historyPage(
    @CurrentUser('id') userId: string,
    @Query({ schema: historyQuerySchema })
    query: z.infer<typeof historyQuerySchema>,
  ): Promise<HistoryPageView> {
    return this.history.page(userId, query.cursor, query.limit);
  }

  @Get('me/detected-transfers')
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser('id') userId: string): Promise<DetectedTransferView[]> {
    return this.transfers.list(userId);
  }

  /** Засчитать перевод как возврат долга в группе. Не больше текущего долга */
  @Post('detected-transfers/:id/apply')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: minutes(1) } })
  apply(
    @CurrentUser('id') userId: string,
    @Param('id', transferIdPipe) id: string,
    @Body({ schema: applySchema }) body: z.infer<typeof applySchema>,
  ): Promise<AppliedTransferView> {
    return this.transfers.apply(id, userId, body.groupId);
  }

  /** «Это не за долг» — подсказка пропадает */
  @Post('detected-transfers/:id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: minutes(1) } })
  dismiss(
    @CurrentUser('id') userId: string,
    @Param('id', transferIdPipe) id: string,
  ): Promise<void> {
    return this.transfers.dismiss(id, userId);
  }
}
