import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type Blockhash, createSolanaRpc } from '@solana/kit';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';

/** Откуда брать свежий blockhash. Абстракция — чтобы тесты не ходили в сеть. */
export abstract class BlockhashSource {
  abstract latest(): Promise<Blockhash>;
}

@Injectable()
export class RpcBlockhashSource extends BlockhashSource {
  private readonly logger = new Logger(RpcBlockhashSource.name);
  private readonly rpc;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.rpc = createSolanaRpc(config.SOLANA_RPC);
  }

  async latest(): Promise<Blockhash> {
    try {
      const { value } = await this.rpc
        .getLatestBlockhash({ commitment: 'confirmed' })
        .send({ abortSignal: AbortSignal.timeout(5_000) });
      return value.blockhash;
    } catch (error) {
      this.logger.warn(
        `Solana RPC недоступен: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        'Сеть Solana недоступна, попробуй через минуту',
      );
    }
  }
}
