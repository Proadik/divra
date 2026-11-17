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
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, Public } from '@nestjs/authentication';
import { Throttle, minutes } from '@nestjs/throttler';
import type {
  PaymentRequestPreview,
  PaymentRequestView,
  SentPaymentRequest,
} from './payment.interface.js';
import { BrowserRequestGuard } from '../auth/browser-request.guard.js';
import {
  type CreatePaymentRequests,
  type PaymentTransactionRequest,
  type SubmitPayment,
  createPaymentRequestsSchema,
  paymentTransactionRequestSchema,
  submitPaymentSchema,
} from './payments.schemas.js';
import { PaymentsService } from './payments.service.js';

const groupIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () => new NotFoundException('Группа не найдена'),
});

@Controller('groups/:groupId/payment-requests')
export class GroupPaymentRequestsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: minutes(1) } })
  create(
    @CurrentUser('id') userId: string,
    @Param('groupId', groupIdPipe) groupId: string,
    @Body({ schema: createPaymentRequestsSchema }) body: CreatePaymentRequests,
  ): Promise<PaymentRequestView[]> {
    return this.payments.createRequests(groupId, userId, body);
  }

  /** Мои запросы в группе: статус, ссылка, QR. Новые сверху, последние 50 */
  @Get()
  @Header('Cache-Control', 'no-store')
  sent(
    @CurrentUser('id') userId: string,
    @Param('groupId', groupIdPipe) groupId: string,
  ): Promise<SentPaymentRequest[]> {
    return this.payments.sent(groupId, userId);
  }
}

/**
 * Страница запроса для того, кто платит: открывается без входа, по коду из ссылки.
 * Код — 128 случайных бит, перебором не найти; лимит запросов это дополнительно страхует.
 */
@Public()
@Controller('payment-requests')
export class PublicPaymentRequestsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':code')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: minutes(1) } })
  preview(@Param('code') code: string): Promise<PaymentRequestPreview> {
    return this.payments.preview(code);
  }

  /**
   * Собрать перевод для кошелька плательщика. Только с нашего фронтенда
   * (BrowserRequestGuard): эндпоинт ходит в RPC, чужим сайтам он не нужен.
   */
  @Post(':code/transaction')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(BrowserRequestGuard)
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  transaction(
    @Param('code') code: string,
    @Body({ schema: paymentTransactionRequestSchema })
    body: PaymentTransactionRequest,
  ): Promise<{ transaction: string; message: string }> {
    return this.payments.buildTransaction(code, body.account);
  }

  /** Отправить подписанный перевод в сеть */
  @Post(':code/submit')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(BrowserRequestGuard)
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  submit(
    @Param('code') code: string,
    @Body({ schema: submitPaymentSchema }) body: SubmitPayment,
  ): Promise<{ signature: string }> {
    return this.payments.submit(code, body.signedTransaction);
  }
}
