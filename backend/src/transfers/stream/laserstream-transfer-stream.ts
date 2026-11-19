import { Logger } from '@nestjs/common';
import { getBase58Decoder } from '@solana/kit';
import {
  CommitmentLevel,
  type StreamHandle,
  type SubscribeRequest,
  type SubscribeUpdate,
  subscribe,
} from 'helius-laserstream';
import type { AppConfig } from '../../config/config.js';
import {
  type ObservedTransaction,
  type TokenBalanceChange,
  type TransactionHandler,
  TransferStream,
} from './transfer-stream.js';

const ENDPOINTS: Record<AppConfig['SOLANA_CLUSTER'], string | null> = {
  devnet: 'https://laserstream-devnet-ewr.helius-rpc.com',
  'mainnet-beta': 'https://laserstream-mainnet-ewr.helius-rpc.com',
  testnet: null,
};

const base58 = getBase58Decoder();

const toBase58 = (value: unknown): string | null =>
  value instanceof Uint8Array && value.length > 0 ? base58.decode(value) : null;

interface RawTokenBalance {
  mint?: string | null;
  owner?: string | null;
  uiTokenAmount?: { amount?: string | null } | null;
}

/** Изменения балансов токенов по (владелец, mint): после − до, без нулевых */
export const balanceChanges = (
  pre: readonly RawTokenBalance[] | null | undefined,
  post: readonly RawTokenBalance[] | null | undefined,
): TokenBalanceChange[] => {
  const totals = new Map<string, TokenBalanceChange>();
  const add = (
    balances: readonly RawTokenBalance[] | null | undefined,
    sign: bigint,
  ): void => {
    for (const item of balances ?? []) {
      const amount = item.uiTokenAmount?.amount;
      if (!item.owner || !item.mint || !amount) {
        continue;
      }
      const key = `${item.owner}:${item.mint}`;
      const entry = totals.get(key) ?? {
        owner: item.owner,
        mint: item.mint,
        delta: 0n,
      };
      entry.delta += sign * BigInt(amount);
      totals.set(key, entry);
    }
  };
  add(post, 1n);
  add(pre, -1n);
  return [...totals.values()].filter((item) => item.delta !== 0n);
};

/** Разбор обновления LaserStream (формат Yellowstone) в ObservedTransaction; не транзакция — null */
export const observedOf = (
  update: SubscribeUpdate,
): ObservedTransaction | null => {
  const info = update.transaction?.transaction;
  const signature = toBase58(info?.signature);
  if (!info || !signature || info.meta?.err) {
    return null;
  }
  const keys = [
    ...(info.transaction?.message?.accountKeys ?? []),
    ...(info.meta?.loadedWritableAddresses ?? []),
    ...(info.meta?.loadedReadonlyAddresses ?? []),
  ].flatMap((key) => {
    const value = toBase58(key);
    return value ? [value] : [];
  });
  return {
    signature,
    slot: Number(update.transaction?.slot ?? 0),
    accounts: keys,
    changes: balanceChanges(
      info.meta?.preTokenBalances,
      info.meta?.postTokenBalances,
    ),
  };
};

/**
 * LaserStream (gRPC Helius): одна подписка на успешные транзакции с нужными аккаунтами.
 * Набор аккаунтов меняется в том же потоке (write), без переподключения. Переподключение
 * и повтор пропущенных слотов SDK делает сам (replay).
 */
export class LaserstreamTransferStream extends TransferStream {
  readonly enabled = true;
  private readonly logger = new Logger(LaserstreamTransferStream.name);
  private readonly endpoint: string;
  private handle: StreamHandle | null = null;
  private handler: TransactionHandler | null = null;
  private fromSlot: number | null = null;
  private accounts: readonly string[] = [];

  constructor(private readonly config: AppConfig) {
    super();
    const endpoint =
      config.LASERSTREAM_ENDPOINT || ENDPOINTS[config.SOLANA_CLUSTER];
    if (!endpoint) {
      throw new Error(`LaserStream не поддерживает ${config.SOLANA_CLUSTER}`);
    }
    this.endpoint = endpoint;
  }

  start(handler: TransactionHandler, fromSlot: number | null): Promise<void> {
    this.handler = handler;
    this.fromSlot = fromSlot;
    return Promise.resolve();
  }

  async watch(accounts: readonly string[]): Promise<void> {
    this.accounts = accounts;
    // Пустой accountInclude значит «все транзакции сети» — такую подписку не открываем
    if (accounts.length === 0) {
      this.handle?.cancel();
      this.handle = null;
      return;
    }
    if (this.handle) {
      await this.handle.write(this.request(null));
      this.logger.log(`LaserStream: слушаем ${accounts.length} аккаунтов`);
      return;
    }
    const handler = this.handler;
    if (!handler) {
      return;
    }
    this.handle = await subscribe(
      {
        apiKey: this.config.HELIUS_API_KEY,
        endpoint: this.endpoint,
        replay: true,
      },
      this.request(this.fromSlot),
      async (update) => {
        const tx = observedOf(update);
        if (!tx) {
          return;
        }
        await handler(tx).catch((error: unknown) => {
          this.logger.warn(
            `Транзакция ${tx.signature} не обработана: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      },
      (error) => {
        this.logger.warn(`LaserStream: ${error.message}`);
      },
    );
    this.logger.log(`LaserStream: слушаем ${accounts.length} аккаунтов`);
  }

  stop(): Promise<void> {
    this.handle?.cancel();
    this.handle = null;
    return Promise.resolve();
  }

  private request(fromSlot: number | null): SubscribeRequest {
    return {
      accounts: {},
      slots: {},
      transactions: {
        divra: {
          accountInclude: [...this.accounts],
          accountExclude: [],
          accountRequired: [],
          vote: false,
          failed: false,
        },
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED,
      ...(fromSlot ? { fromSlot } : {}),
    };
  }
}
