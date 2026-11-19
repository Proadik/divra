/** Изменение баланса токена у владельца в одной транзакции (после − до), минимальные единицы */
export interface TokenBalanceChange {
  owner: string;
  mint: string;
  delta: bigint;
}

/** Успешная транзакция из потока, уже разобранная */
export interface ObservedTransaction {
  signature: string;
  slot: number;
  /** Все аккаунты транзакции (base58), включая загруженные из lookup-таблиц */
  accounts: string[];
  changes: TokenBalanceChange[];
}

export type TransactionHandler = (tx: ObservedTransaction) => Promise<void>;

/**
 * Поток транзакций, затрагивающих заданные аккаунты. Абстракция — тесты в сеть не ходят.
 * Реализация — LaserStream (gRPC Helius); без ключа поток выключен.
 */
export abstract class TransferStream {
  /** false — потока нет (ключ не задан): функция «переводы мимо Divra» выключена */
  abstract readonly enabled: boolean;

  /**
   * Куда отдавать транзакции. fromSlot — догнать пропущенное после перезапуска
   * (в пределах окна повтора провайдера). Пока watch() не задал аккаунты, транзакций нет.
   */
  abstract start(
    handler: TransactionHandler,
    fromSlot: number | null,
  ): Promise<void>;

  /** Заменить набор отслеживаемых аккаунтов. Пустой — ничего не слушать */
  abstract watch(accounts: readonly string[]): Promise<void>;

  abstract stop(): Promise<void>;
}

/** Ключа нет — потока нет */
export class DisabledTransferStream extends TransferStream {
  readonly enabled = false;

  start(): Promise<void> {
    return Promise.resolve();
  }

  watch(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}
