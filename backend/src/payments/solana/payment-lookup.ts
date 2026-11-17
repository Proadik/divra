import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Signature, address, createSolanaRpc } from '@solana/kit';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';

export interface TransferQuery {
  /** Solana Pay reference запроса */
  reference: string;
  /** Кошелёк получателя (владелец токен-аккаунта) */
  recipient: string;
  mint: string;
}

export interface FoundTransfer {
  signature: string;
  /** Сколько минимальных единиц токена пришло получателю в этой транзакции */
  rawAmount: bigint;
}

export type Confirmation = 'pending' | 'confirmed' | 'finalized' | 'failed';

/** Чтение переводов из сети. Абстракция — тесты в сеть не ходят. */
export abstract class PaymentLookup {
  /** Все успешные транзакции с этим reference, где получатель получил токен mint */
  abstract findTransfers(query: TransferQuery): Promise<FoundTransfer[]>;

  /** Статус отправленной транзакции */
  abstract getConfirmation(signature: string): Promise<Confirmation>;

  /**
   * Сколько токена mint получил каждый владелец в этой транзакции (минимальные единицы).
   * null — транзакции ещё нет или она завершилась ошибкой.
   */
  abstract receivedBy(
    signature: string,
    mint: string,
  ): Promise<Map<string, bigint> | null>;
}

interface TokenBalance {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

interface TokenBalancesMeta {
  preTokenBalances?: readonly TokenBalance[] | null;
  postTokenBalances?: readonly TokenBalance[] | null;
}

const received = (
  balances: readonly TokenBalance[] | null | undefined,
  { recipient, mint }: Pick<TransferQuery, 'recipient' | 'mint'>,
): bigint =>
  (balances ?? [])
    .filter((item) => item.owner === recipient && item.mint === mint)
    .reduce((sum, item) => sum + BigInt(item.uiTokenAmount.amount), 0n);

/** Изменение баланса токена mint по владельцам: после − до */
export const deltasByOwner = (
  meta: TokenBalancesMeta,
  mint: string,
): Map<string, bigint> => {
  const deltas = new Map<string, bigint>();
  const add = (
    balances: readonly TokenBalance[] | null | undefined,
    sign: bigint,
  ) => {
    for (const item of balances ?? []) {
      if (item.mint === mint && item.owner) {
        deltas.set(
          item.owner,
          (deltas.get(item.owner) ?? 0n) +
            sign * BigInt(item.uiTokenAmount.amount),
        );
      }
    }
  };
  add(meta.postTokenBalances, 1n);
  add(meta.preTokenBalances, -1n);
  return deltas;
};

/**
 * На сколько минимальных единиц вырос баланс токена mint у владельца recipient.
 * Токен-аккаунт мог появиться в этой же транзакции — тогда «до» его нет, это 0.
 */
export const receivedAmount = (
  meta: TokenBalancesMeta,
  query: Pick<TransferQuery, 'recipient' | 'mint'>,
): bigint =>
  received(meta.postTokenBalances, query) -
  received(meta.preTokenBalances, query);

/**
 * Проверка по спецификации Solana Pay (validateTransfer): транзакция содержит reference
 * (её нашли getSignaturesForAddress по нему), выполнена без ошибки, и баланс токена mint
 * у владельца recipient вырос. Сумму сверяет сервис.
 */
@Injectable()
export class RpcPaymentLookup extends PaymentLookup {
  private readonly logger = new Logger(RpcPaymentLookup.name);
  private readonly rpc;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.rpc = createSolanaRpc(config.SOLANA_RPC);
  }

  async findTransfers(query: TransferQuery): Promise<FoundTransfer[]> {
    const signal = (): AbortSignal => AbortSignal.timeout(5_000);
    const signatures = await this.rpc
      .getSignaturesForAddress(address(query.reference), {
        limit: 10,
        commitment: 'confirmed',
      })
      .send({ abortSignal: signal() });

    const found: FoundTransfer[] = [];
    // Старые первыми: засчитываем самую раннюю оплату
    for (const item of [...signatures].reverse()) {
      if (item.err) {
        continue;
      }
      const tx = await this.rpc
        .getTransaction(item.signature as Signature, {
          encoding: 'jsonParsed',
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        })
        .send({ abortSignal: signal() });
      if (!tx?.meta || tx.meta.err) {
        continue;
      }
      const delta = receivedAmount(
        tx.meta as unknown as TokenBalancesMeta,
        query,
      );
      if (delta > 0n) {
        found.push({ signature: item.signature, rawAmount: delta });
      } else {
        this.logger.debug(`${item.signature}: перевода получателю нет`);
      }
    }
    return found;
  }

  async getConfirmation(signature: string): Promise<Confirmation> {
    const { value } = await this.rpc
      .getSignatureStatuses([signature as Signature])
      .send({ abortSignal: AbortSignal.timeout(5_000) });
    const status = value[0];
    if (!status) {
      return 'pending';
    }
    if (status.err) {
      return 'failed';
    }
    return status.confirmationStatus === 'confirmed' ||
      status.confirmationStatus === 'finalized'
      ? status.confirmationStatus
      : 'pending';
  }

  async receivedBy(
    signature: string,
    mint: string,
  ): Promise<Map<string, bigint> | null> {
    const tx = await this.rpc
      .getTransaction(signature as Signature, {
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      })
      .send({ abortSignal: AbortSignal.timeout(5_000) });
    if (!tx?.meta || tx.meta.err) {
      return null;
    }
    return deltasByOwner(tx.meta as unknown as TokenBalancesMeta, mint);
  }
}
