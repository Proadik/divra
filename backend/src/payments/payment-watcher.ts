import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PaymentsService } from './payments.service.js';
import { SettlementsService } from './settlements/settlements.service.js';

/**
 * Фоновый поиск оплат: друг может заплатить по QR и закрыть страницу — долг всё равно
 * погасится. Один процесс, прогоны не накладываются. Для нескольких реплик
 * понадобится блокировка (pg advisory lock) или отдельный воркер.
 */
@Injectable()
export class PaymentWatcher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PaymentWatcher.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementsService,
  ) {}

  onApplicationBootstrap(): void {
    const interval = this.config.PAYMENT_WATCH_INTERVAL_MS;
    if (interval === 0) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.payments.checkDue();
      await this.settlements.checkSubmitted();
    } catch (error) {
      this.logger.warn(
        `Поиск оплат не удался: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
