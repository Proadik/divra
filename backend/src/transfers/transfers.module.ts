import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { LaserstreamTransferStream } from './stream/laserstream-transfer-stream.js';
import {
  DisabledTransferStream,
  TransferStream,
} from './stream/transfer-stream.js';
import { HistoryRepository } from './history.repository.js';
import { HistoryService } from './history.service.js';
import { TransferWatcher } from './transfer-watcher.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersRepository } from './transfers.repository.js';
import { TransfersService } from './transfers.service.js';

/** Переводы между участниками, сделанные мимо Divra: поток LaserStream → подсказки получателю */
@Module({
  imports: [PaymentsModule],
  controllers: [TransfersController],
  providers: [
    TransfersRepository,
    TransfersService,
    HistoryRepository,
    HistoryService,
    TransferWatcher,
    {
      provide: TransferStream,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): TransferStream =>
        config.HELIUS_API_KEY
          ? new LaserstreamTransferStream(config)
          : new DisabledTransferStream(),
    },
  ],
})
export class TransfersModule {}
