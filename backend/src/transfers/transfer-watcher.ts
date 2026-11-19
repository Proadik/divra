import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { address } from '@solana/kit';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DomainEvents } from '../events/domain-events.js';
import { recipientTokenAccount } from '../payments/solana/payment-transaction.js';
import { TransferStream } from './stream/transfer-stream.js';
import { TransfersRepository } from './transfers.repository.js';
import { TransfersService } from './transfers.service.js';

/** Сколько ждать после изменения состава, прежде чем пересобрать подписку */
const REFRESH_DEBOUNCE_MS = 1_000;

/**
 * Держит поток переводов: при старте подписывается на токен-аккаунты USDC/USDT участников,
 * при изменении состава групп пересобирает набор (в том же потоке). Рассчитан на один процесс:
 * при нескольких репликах поток должен держать одна (advisory lock или отдельный воркер).
 */
@Injectable()
export class TransferWatcher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TransferWatcher.name);
  private unsubscribe: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> = Promise.resolve();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly stream: TransferStream,
    private readonly transfers: TransfersService,
    private readonly repository: TransfersRepository,
    private readonly events: DomainEvents,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.stream.enabled) {
      this.logger.log(
        'HELIUS_API_KEY не задан — переводы мимо Divra не отслеживаются',
      );
      return;
    }
    const fromSlot = await this.repository.loadSlot();
    await this.stream.start(async (tx) => {
      await this.transfers.handle(tx);
      if (tx.slot > 0) {
        await this.repository.saveSlot(tx.slot);
      }
    }, fromSlot);
    this.unsubscribe = this.events.on((event) => {
      if (event.type === 'membership.changed') {
        this.scheduleRefresh();
      }
    });
    await this.refresh();
  }

  async onApplicationShutdown(): Promise<void> {
    this.unsubscribe?.();
    if (this.timer) {
      clearTimeout(this.timer);
    }
    await this.stream.stop();
  }

  /** Пересобрать набор аккаунтов сейчас (после ожидающей пересборки, если она идёт) */
  refresh(): Promise<void> {
    this.refreshing = this.refreshing.then(() =>
      this.rebuild().catch((error: unknown) => {
        this.logger.warn(
          `Подписка не обновлена: ${error instanceof Error ? error.message : String(error)}`,
        );
      }),
    );
    return this.refreshing;
  }

  private scheduleRefresh(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private async rebuild(): Promise<void> {
    const owners = await this.repository.watchedOwners();
    const watched = await Promise.all(
      owners.map(async (owner) => ({
        owner,
        accounts: await Promise.all(
          this.transfers.tokens.map(async ({ mint, token }) => ({
            token,
            account: await recipientTokenAccount(address(owner), address(mint)),
          })),
        ),
      })),
    );
    // Отладка: сам токен — в фильтре, тогда приходят все его переводы через transferChecked
    const mints = this.config.TRANSFER_LOG_ALL
      ? this.transfers.tokens.map(({ mint }) => mint)
      : [];
    await this.stream.watch([
      ...mints,
      ...watched.flatMap((item) => item.accounts.map(({ account }) => account)),
    ]);
    this.logWatched(watched);
    if (mints.length > 0) {
      this.logger.log(
        `TRANSFER_LOG_ALL: в лог попадут все переводы ${this.transfers.tokens.map(({ token }) => token).join(', ')} в сети`,
      );
    }
  }

  /** Какие кошельки слушаем: переводы на них (и с них) попадут в детект */
  private logWatched(
    watched: Array<{
      owner: string;
      accounts: Array<{ token: string; account: string }>;
    }>,
  ): void {
    if (watched.length === 0) {
      this.logger.log(
        'Переводы мимо Divra: слушать некого — нет групп, где у двух участников есть кошельки',
      );
      return;
    }
    const lines = watched.map(
      ({ owner, accounts }) =>
        `  ${owner}  ${accounts.map(({ token, account }) => `${token}: ${account}`).join('  ')}`,
    );
    this.logger.log(
      `Переводы мимо Divra: слушаем ${watched.length} кошельков (кошелёк → токен-аккаунты)\n${lines.join('\n')}`,
    );
  }
}
