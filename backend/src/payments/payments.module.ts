import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { UsersModule } from '../users/users.module.js';
import { PaymentWatcher } from './payment-watcher.js';
import {
  SettlementsController,
  WalletsController,
} from './settlements/settlements.controller.js';
import { SettlementsRepository } from './settlements/settlements.repository.js';
import {
  SETTLEMENT_TIMING,
  SettlementsService,
} from './settlements/settlements.service.js';
import { BalanceReader, RpcBalanceReader } from './solana/balance-reader.js';
import {
  GroupPaymentRequestsController,
  PublicPaymentRequestsController,
} from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { DrizzlePaymentsRepository } from './repositories/drizzle-payments.repository.js';
import { PaymentsRepository } from './repositories/payments.repository.js';
import {
  BlockhashSource,
  RpcBlockhashSource,
} from '../auth/solana/blockhash.source.js';
import { PaymentLookup, RpcPaymentLookup } from './solana/payment-lookup.js';
import {
  RpcTransactionSender,
  TransactionSender,
} from './solana/transaction-sender.js';

@Module({
  imports: [GroupsModule, UsersModule],
  controllers: [
    GroupPaymentRequestsController,
    PublicPaymentRequestsController,
    SettlementsController,
    WalletsController,
  ],
  providers: [
    PaymentsService,
    PaymentWatcher,
    SettlementsService,
    SettlementsRepository,
    {
      provide: SETTLEMENT_TIMING,
      useValue: { attempts: 30, intervalMs: 1_000 },
    },
    { provide: BalanceReader, useClass: RpcBalanceReader },
    { provide: PaymentsRepository, useClass: DrizzlePaymentsRepository },
    { provide: PaymentLookup, useClass: RpcPaymentLookup },
    { provide: TransactionSender, useClass: RpcTransactionSender },
    { provide: BlockhashSource, useClass: RpcBlockhashSource },
  ],
})
export class PaymentsModule {}
