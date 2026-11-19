import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { STABLECOINS, type Stablecoin } from '../database/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { PaymentLookup } from '../payments/solana/payment-lookup.js';
import { stablecoinMint } from '../payments/solana/stablecoins.js';
import type { ObservedTransaction } from './stream/transfer-stream.js';
import {
  HistoryRepository,
  type NewChainTransfer,
} from './history.repository.js';
import { TransfersRepository } from './transfers.repository.js';

/** Сколько подсказка живёт: старый перевод вряд ли про нынешний долг */
const PENDING_TTL_MS = 30 * 24 * 3_600_000;

/** Контракт — frontend/src/shared/api/transfers/schemas.ts */
export interface DetectedTransferView {
  id: string;
  signature: string;
  token: Stablecoin;
  /** Сколько пришло, в долларах (стейблкоин 1:1) */
  amount: number;
  fromName: string;
  createdAt: string;
  /** Где отправитель сейчас должен тебе — туда можно засчитать. Первая — с самым большим долгом */
  groups: Array<{ groupId: string; groupName: string; owed: number }>;
}

export interface AppliedTransferView {
  groupId: string;
  amount: number;
  remaining: number;
}

const toDollars = (cents: number): number => cents / 100;

/**
 * Переводы мимо Divra. Поток (TransferWatcher) отдаёт сюда транзакции с токен-аккаунтами
 * участников; если отправитель должен получателю хотя бы в одной общей группе — сохраняется
 * подсказка, и получатель решает, засчитать ли её. Засчитывание перепроверяет транзакцию в сети.
 */
@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);
  private readonly tokensByMint: Map<string, Stablecoin>;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly repository: TransfersRepository,
    private readonly history: HistoryRepository,
    private readonly lookup: PaymentLookup,
    private readonly events: DomainEvents,
  ) {
    this.tokensByMint = new Map(
      STABLECOINS.flatMap((token) => {
        const mint = stablecoinMint(config.SOLANA_CLUSTER, token);
        return mint ? [[mint, token] as const] : [];
      }),
    );
  }

  /** Отслеживаемые токены этой сети: USDC и USDT (если есть) */
  get tokens(): Array<{ mint: string; token: Stablecoin }> {
    return [...this.tokensByMint].map(([mint, token]) => ({ mint, token }));
  }

  /** Транзакция из потока. Возвращает id новых подсказок (для тестов и логов) */
  async handle(tx: ObservedTransaction): Promise<string[]> {
    const changes = tx.changes.filter((change) =>
      this.tokensByMint.has(change.mint),
    );
    this.logTransfers(tx, changes);
    // Причины пропуска пишем, только когда в переводе есть пользователь Divra:
    // в режиме TRANSFER_LOG_ALL остальные переводы сети — просто строка в логе
    let involvesDivra = false;
    const skip = (reason: string): void => {
      if (involvesDivra) {
        this.logger.log(`Транзакция ${tx.signature}: пропущена — ${reason}`);
      }
    };
    const received = changes.filter((change) => change.delta > 0n);
    const sent = changes.filter((change) => change.delta < 0n);
    if (received.length === 0 || sent.length === 0) {
      return [];
    }
    const owners = await this.repository.usersByAddresses([
      ...new Set(changes.map((change) => change.owner)),
    ]);
    involvesDivra = owners.size > 0;
    await this.index(tx, received, sent, owners);
    // Перевод по нашей ссылке или расчёт засчитает основной механизм
    if (await this.repository.hasKnownReference(tx.accounts)) {
      skip(
        'это перевод по запросу или расчёт Divra — его засчитает основной механизм',
      );
      return [];
    }
    const created: string[] = [];
    for (const to of received) {
      const recipient = owners.get(to.owner);
      if (!recipient) {
        skip(`получатель ${to.owner} — не пользователь Divra`);
        continue;
      }
      if (!recipient.detectTransfers) {
        skip(`у получателя ${to.owner} выключено «Замечать переводы»`);
        continue;
      }
      for (const from of sent) {
        const sender = owners.get(from.owner);
        if (!sender) {
          skip(`отправитель ${from.owner} — не пользователь Divra`);
          continue;
        }
        if (from.mint !== to.mint || sender.userId === recipient.userId) {
          continue;
        }
        const debts = await this.repository.debtsBetween(
          sender.userId,
          recipient.userId,
        );
        if (debts.length === 0) {
          skip(
            `${from.owner} не должен ${to.owner} ни в одной общей группе (подсказка — только когда переводит должник)`,
          );
          continue;
        }
        const rawAmount = to.delta < -from.delta ? to.delta : -from.delta;
        const id = await this.repository.insert({
          signature: tx.signature,
          slot: tx.slot,
          token: this.tokensByMint.get(to.mint) ?? 'USDC',
          mint: to.mint,
          rawAmount,
          fromUserId: sender.userId,
          toUserId: recipient.userId,
          fromAddress: from.owner,
          toAddress: to.owner,
        });
        if (id) {
          created.push(id);
          this.logger.log(`Замечен перевод ${tx.signature} → подсказка ${id}`);
          this.events.emit({
            type: 'transfer.detected',
            userId: recipient.userId,
            id,
          });
        }
      }
    }
    return created;
  }

  /**
   * Индекс для «Истории»: каждый получатель стейблкоина в транзакции — строка, если с одной
   * из сторон пользователь Divra. Отправитель — тот, у кого больше всего ушло этого токена.
   */
  private async index(
    tx: ObservedTransaction,
    received: ObservedTransaction['changes'],
    sent: ObservedTransaction['changes'],
    owners: Map<string, { userId: string }>,
  ): Promise<void> {
    const rows: NewChainTransfer[] = received.flatMap((to) => {
      const from = sent
        .filter((change) => change.mint === to.mint)
        .sort((a, b) => (a.delta < b.delta ? -1 : 1))[0];
      const fromUserId = from ? (owners.get(from.owner)?.userId ?? null) : null;
      const toUserId = owners.get(to.owner)?.userId ?? null;
      if (!from || (!fromUserId && !toUserId)) {
        return [];
      }
      return [
        {
          signature: tx.signature,
          slot: tx.slot,
          token: this.tokensByMint.get(to.mint) ?? 'USDC',
          mint: to.mint,
          rawAmount: to.delta,
          fromAddress: from.owner,
          toAddress: to.owner,
          fromUserId,
          toUserId,
        },
      ];
    });
    if ((await this.history.record(rows)) > 0) {
      const userIds = [
        ...new Set(
          rows.flatMap((row) =>
            [row.fromUserId, row.toUserId].filter(
              (id): id is string => id !== null,
            ),
          ),
        ),
      ];
      this.events.emit({ type: 'history.changed', userIds });
    }
  }

  /** «Перевод USDC 12.5: A → B» — каждая транзакция из потока с переводом стейблкоина */
  private logTransfers(
    tx: ObservedTransaction,
    changes: ObservedTransaction['changes'],
  ): void {
    const lines = this.tokens.flatMap(({ mint, token }) => {
      const ofMint = changes.filter((change) => change.mint === mint);
      const from = ofMint.filter((change) => change.delta < 0n);
      const to = ofMint.filter((change) => change.delta > 0n);
      if (to.length === 0) {
        return [];
      }
      return to.map(
        (item) =>
          `${token} ${Number(item.delta) / 1e6}: ${from.map((change) => change.owner).join(', ') || '—'} → ${item.owner}`,
      );
    });
    if (lines.length > 0) {
      this.logger.log(
        `Перевод (слот ${tx.slot}, ${tx.signature}): ${lines.join('; ')}`,
      );
    }
  }

  async list(userId: string): Promise<DetectedTransferView[]> {
    const pending = await this.repository.listPending(
      userId,
      new Date(Date.now() - PENDING_TTL_MS),
    );
    const views: DetectedTransferView[] = [];
    for (const item of pending) {
      const debts = (
        await this.repository.debtsBetween(item.fromUserId, userId)
      ).sort((a, b) => b.owedCents - a.owedCents);
      const [first] = debts;
      // Долга больше нет — подсказывать нечего
      if (!first) {
        continue;
      }
      views.push({
        id: item.id,
        signature: item.signature,
        token: item.token,
        amount: Number(item.rawAmount / 10_000n) / 100,
        fromName: first.fromName,
        createdAt: item.createdAt.toISOString(),
        groups: debts.map((debt) => ({
          groupId: debt.groupId,
          groupName: debt.groupName,
          owed: toDollars(debt.owedCents),
        })),
      });
    }
    return views;
  }

  /** Засчитать перевод в группе. Транзакция перечитывается из сети — потоку на слово не верим */
  async apply(
    id: string,
    userId: string,
    groupId: string,
  ): Promise<AppliedTransferView> {
    const transfer = await this.repository.findPending(id, userId);
    if (!transfer) {
      throw transferNotFound();
    }
    const deltas = await this.lookup.receivedBy(
      transfer.signature,
      transfer.mint,
    );
    if (!deltas) {
      throw new ConflictException(
        'Сеть ещё не подтвердила перевод — попробуй через минуту',
      );
    }
    const received = deltas.get(transfer.toAddress) ?? 0n;
    const sent = deltas.get(transfer.fromAddress) ?? 0n;
    if (received < transfer.rawAmount || sent >= 0n) {
      throw new ConflictException('Перевод в сети не совпадает с подсказкой');
    }
    const result = await this.repository.apply({
      id,
      userId,
      groupId,
      at: new Date(),
    });
    if (!result.ok) {
      switch (result.reason) {
        case 'not-found':
          throw transferNotFound();
        case 'no-debt':
          throw new ConflictException(
            'В этой группе он тебе больше ничего не должен',
          );
        case 'already-counted':
          throw new ConflictException('Этот перевод уже засчитан');
      }
    }
    this.events.emit({ type: 'group.changed', groupId: result.groupId });
    return {
      groupId: result.groupId,
      amount: toDollars(result.amountCents),
      remaining: toDollars(result.remainingCents),
    };
  }

  async dismiss(id: string, userId: string): Promise<void> {
    if (!(await this.repository.dismiss(id, userId, new Date()))) {
      throw transferNotFound();
    }
  }
}

const transferNotFound = (): NotFoundException =>
  new NotFoundException('Перевод не найден');
