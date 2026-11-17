import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { type Blockhash, getAddressDecoder } from '@solana/kit';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { BlockhashSource } from '../src/auth/solana/blockhash.source.js';
import { configureApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/config.js';
import {
  type Confirmation,
  type FoundTransfer,
  PaymentLookup,
  type TransferQuery,
} from '../src/payments/solana/payment-lookup.js';
import { BalanceReader } from '../src/payments/solana/balance-reader.js';
import { SETTLEMENT_TIMING } from '../src/payments/settlements/settlements.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { SettlementsService } from '../src/payments/settlements/settlements.service.js';
import { TransactionSender } from '../src/payments/solana/transaction-sender.js';

/** Отправка в «сеть» для тестов: запоминает транзакции, подпись — фиктивная */
export class FakeTransactionSender extends TransactionSender {
  readonly sent: string[] = [];
  failWith: Error | null = null;

  send(base64: string): Promise<string> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    this.sent.push(base64);
    return Promise.resolve(`fake-signature-${this.sent.length}`);
  }

  /** Подпись, которую вернёт следующая отправка */
  peekNext(): string {
    return `fake-signature-${this.sent.length + 1}`;
  }
}

/** «Сеть Solana» для тестов: какие переводы есть по каждому reference */
export class FakePaymentLookup extends PaymentLookup {
  readonly transfers = new Map<string, FoundTransfer[]>();
  readonly queries: TransferQuery[] = [];
  failing = false;

  findTransfers(query: TransferQuery): Promise<FoundTransfer[]> {
    this.queries.push(query);
    if (this.failing) {
      return Promise.reject(new Error('RPC недоступен'));
    }
    return Promise.resolve(this.transfers.get(query.reference) ?? []);
  }

  /** Статус транзакций по подписи; нет записи — confirmed */
  readonly confirmations = new Map<string, Confirmation>();
  /** Кто сколько получил в транзакции (минимальные единицы) */
  readonly received = new Map<string, Map<string, bigint>>();

  getConfirmation(signature: string): Promise<Confirmation> {
    return Promise.resolve(this.confirmations.get(signature) ?? 'confirmed');
  }

  receivedBy(signature: string): Promise<Map<string, bigint> | null> {
    return Promise.resolve(this.received.get(signature) ?? null);
  }
}

/** Балансы кошельков для тестов: по умолчанию 100 USDC */
export class FakeBalanceReader extends BalanceReader {
  readonly balances = new Map<string, bigint>();

  balanceOf(owner: string): Promise<bigint> {
    return Promise.resolve(this.balances.get(owner) ?? 100_000_000n);
  }
}

/** Похож на настоящий blockhash (32 байта в base58) — в сеть тесты не ходят */
export const FAKE_BLOCKHASH = getAddressDecoder().decode(
  randomBytes(32),
) as unknown as Blockhash;

export const createTestDatabase = async (): Promise<
  ReturnType<typeof drizzle>
> => {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: './drizzle' });
  return db;
};

/** Всё приложение, как в main.ts, но на PGlite и с подменённым Solana RPC */
export const createTestApp = async (): Promise<{
  app: INestApplication<App>;
  db: Awaited<ReturnType<typeof createTestDatabase>>;
  chain: FakePaymentLookup;
  sender: FakeTransactionSender;
  payments: PaymentsService;
  settlements: SettlementsService;
}> => {
  const db = await createTestDatabase();
  const chain = new FakePaymentLookup();
  const sender = new FakeTransactionSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getDrizzleToken())
    .useValue(db)
    .overrideProvider(BlockhashSource)
    .useValue({ latest: () => Promise.resolve(FAKE_BLOCKHASH) })
    .overrideProvider(PaymentLookup)
    .useValue(chain)
    .overrideProvider(TransactionSender)
    .useValue(sender)
    .overrideProvider(BalanceReader)
    .useValue(new FakeBalanceReader())
    // Подтверждение ждём недолго: в тестах сеть «отвечает» сразу
    .overrideProvider(SETTLEMENT_TIMING)
    .useValue({ attempts: 3, intervalMs: 5 })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });
  configureApp(app, loadConfig());
  await app.init();
  return {
    app: app as unknown as INestApplication<App>,
    db,
    chain,
    sender,
    payments: app.get(PaymentsService),
    settlements: app.get(SettlementsService),
  };
};

/** Каждому тесту — свой «IP», чтобы лимиты одного теста не задевали другой */
export const freshIp = (): string =>
  `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;

/** Заголовки запроса с нашего фронтенда (BrowserRequestGuard) */
export const ORIGIN_HEADERS = {
  'X-Divra-Client': 'web',
  Origin: 'http://localhost:5173',
};
