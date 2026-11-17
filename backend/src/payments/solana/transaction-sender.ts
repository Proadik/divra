import {
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type Base64EncodedWireTransaction,
  createSolanaRpc,
} from '@solana/kit';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';

/** Отправка подписанной транзакции в сеть. Абстракция — тесты в сеть не ходят. */
export abstract class TransactionSender {
  /** Возвращает подпись транзакции; сеть отклонила — 422 с понятной причиной */
  abstract send(base64: string): Promise<string>;
}

const reasonOf = (error: unknown): string => {
  const text = JSON.stringify(
    error instanceof Error ? { m: error.message, c: error.cause } : error,
  );
  if (/insufficient (funds|lamports)|0x1\b|"Custom":1\b/i.test(text)) {
    return 'Не хватает стейблкоина на кошельке или SOL на комиссию';
  }
  if (/blockhash not found|block height exceeded/i.test(text)) {
    return 'Транзакция устарела — попробуй ещё раз';
  }
  if (/already been processed/i.test(text)) {
    return 'Эта транзакция уже отправлена';
  }
  return 'Сеть Solana отклонила перевод';
};

@Injectable()
export class RpcTransactionSender extends TransactionSender {
  private readonly logger = new Logger(RpcTransactionSender.name);
  private readonly rpc;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.rpc = createSolanaRpc(config.SOLANA_RPC);
  }

  async send(base64: string): Promise<string> {
    try {
      // Preflight: сеть сначала симулирует перевод и сразу скажет, если денег не хватает
      return await this.rpc
        .sendTransaction(base64 as Base64EncodedWireTransaction, {
          encoding: 'base64',
          preflightCommitment: 'confirmed',
        })
        .send({ abortSignal: AbortSignal.timeout(10_000) });
    } catch (error) {
      const reason = reasonOf(error);
      this.logger.warn(
        `sendTransaction: ${reason} (${error instanceof Error ? error.message : String(error)})`,
      );
      throw new UnprocessableEntityException(reason);
    }
  }
}
