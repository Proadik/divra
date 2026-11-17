import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { address, getAddressDecoder } from '@solana/kit';
import { BlockhashSource } from '../../auth/solana/blockhash.source.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import type { Stablecoin } from '../../database/schema/index.js';
import { GroupsService } from '../../groups/groups.service.js';
import { UsersRepository } from '../../users/repositories/users.repository.js';
import { PaymentLookup } from '../solana/payment-lookup.js';
import {
  buildTransfersTransaction,
  fitsInPacket,
  isTransfersTransaction,
  recipientTokenAccount,
} from '../solana/payment-transaction.js';
import { RAW_UNITS_PER_CENT, stablecoinMint } from '../solana/stablecoins.js';
import { TransactionSender } from '../solana/transaction-sender.js';
import type { PrepareSettlement } from './settlements.schemas.js';
import {
  type SettlementRecord,
  SettlementsRepository,
} from './settlements.repository.js';

/** Сколько живёт собранная транзакция: blockhash в Solana действует около минуты */
const SETTLEMENT_TTL_MS = 2 * 60_000;

/** Контракт — frontend/src/shared/api/payments/schemas.ts */
interface TransferView {
  memberId: string;
  name: string;
  address: string;
  amount: number;
}

export interface PreparedSettlement {
  settlementId: string;
  chain: 'solana';
  token: Stablecoin;
  transaction: string;
  transfers: TransferView[];
  total: number;
  expiresAt: string;
}

export interface SettlementResult {
  settlementId: string;
  signature: string;
  status: 'confirmed' | 'finalized';
  token: Stablecoin;
  transfers: TransferView[];
  total: number;
}

export interface SettlementTiming {
  /** Сколько раз спросить сеть о подтверждении и с какой паузой */
  attempts: number;
  intervalMs: number;
}

export const SETTLEMENT_TIMING = Symbol('SETTLEMENT_TIMING');

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const settlementNotFound = (): NotFoundException =>
  new NotFoundException('Расчёт не найден');

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SETTLEMENT_TIMING) private readonly timing: SettlementTiming,
    private readonly groups: GroupsService,
    private readonly users: UsersRepository,
    private readonly repository: SettlementsRepository,
    private readonly lookup: PaymentLookup,
    private readonly sender: TransactionSender,
    private readonly blockhashes: BlockhashSource,
  ) {}

  /**
   * Шаг 1: проверить долги и собрать одну транзакцию с переводами. Получатели, их адреса
   * и предел суммы — с сервера: клиент выбирает только кому и сколько (не больше долга).
   */
  async prepare(
    groupId: string,
    userId: string,
    input: PrepareSettlement,
  ): Promise<PreparedSettlement> {
    const ledger = await this.groups.ledgerFor(groupId, userId);
    if (!ledger) {
      throw new NotFoundException('Группа не найдена');
    }
    const profile = await this.users.getProfile(userId);
    const ownsPayer = profile?.wallets.some(
      (wallet) => wallet.chain === 'solana' && wallet.address === input.payer,
    );
    if (!ownsPayer) {
      throw new UnprocessableEntityException('Это не твой кошелёк');
    }
    const mint = stablecoinMint(this.config.SOLANA_CLUSTER, input.token);
    if (!mint) {
      throw new BadRequestException(
        `${input.token} нет в этой сети Solana — выбери другой стейблкоин`,
      );
    }

    const transfers = input.transfers.map((item) => {
      const member = ledger.members.find((m) => m.id === item.memberId);
      if (!member || member.id === ledger.me.id) {
        throw new UnprocessableEntityException('Получатель не из этой группы');
      }
      if (!member.userId || !member.address) {
        throw new ConflictException(
          `У ${member.displayName} нет кошелька — перевести некуда`,
        );
      }
      if (member.address === input.payer) {
        throw new UnprocessableEntityException('Нельзя перевести самому себе');
      }
      const owed =
        ledger.debts.find(
          (debt) => debt.fromId === ledger.me.id && debt.toId === member.id,
        )?.cents ?? 0;
      if (item.amount > owed) {
        throw new ConflictException(
          owed > 0
            ? `Ты должен ${member.displayName} ${(owed / 100).toFixed(2)} — больше перевести нельзя`
            : `Ты ничего не должен ${member.displayName}`,
        );
      }
      return {
        memberId: member.id,
        name: member.displayName,
        address: member.address,
        amountCents: item.amount,
      };
    });

    const reference = getAddressDecoder().decode(randomBytes(32));
    const transaction = await buildTransfersTransaction({
      payer: address(input.payer),
      mint: address(mint),
      reference,
      blockhash: await this.blockhashes.latest(),
      transfers: transfers.map((transfer) => ({
        recipient: address(transfer.address),
        rawAmount: BigInt(transfer.amountCents) * RAW_UNITS_PER_CENT,
      })),
    });
    if (!fitsInPacket(transaction)) {
      throw new UnprocessableEntityException(
        'Слишком много получателей для одной транзакции — раздели расчёт',
      );
    }
    const expiresAt = new Date(Date.now() + SETTLEMENT_TTL_MS);
    const settlementId = await this.repository.create({
      groupId,
      payerMemberId: ledger.me.id,
      createdBy: userId,
      payerAddress: input.payer,
      token: input.token,
      mint,
      reference,
      expiresAt,
      transfers,
    });
    return {
      settlementId,
      chain: 'solana',
      token: input.token,
      transaction,
      transfers: transfers.map(toView),
      total: totalOf(transfers),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Шаг 2: отправить подписанную транзакцию, дождаться подтверждения и сверить в сети,
   * что каждый получатель получил свою сумму. Долги гасятся только сверенными переводами.
   */
  async submit(
    groupId: string,
    userId: string,
    settlementId: string,
    signedTransaction: string,
  ): Promise<SettlementResult> {
    const settlement = await this.repository.find(settlementId);
    if (
      !settlement ||
      settlement.groupId !== groupId ||
      settlement.createdBy !== userId
    ) {
      throw settlementNotFound();
    }
    if (settlement.status !== 'prepared') {
      throw new ConflictException('Этот расчёт уже отправлен');
    }
    const destinations = await Promise.all(
      settlement.transfers.map((transfer) =>
        recipientTokenAccount(
          address(transfer.address),
          address(settlement.mint),
        ),
      ),
    );
    if (
      !isTransfersTransaction(signedTransaction, {
        reference: address(settlement.reference),
        destinations,
      })
    ) {
      throw new BadRequestException('Это не транзакция этого расчёта');
    }
    if (!(await this.repository.claimForSubmit(settlement.id, new Date()))) {
      if (settlement.expiresAt <= new Date()) {
        throw new GoneException('Транзакция устарела — начни расчёт заново');
      }
      throw new ConflictException('Этот расчёт уже отправлен');
    }

    let signature: string;
    try {
      signature = await this.sender.send(signedTransaction);
    } catch (error) {
      await this.repository.markFailed(settlement.id);
      throw error;
    }
    await this.repository.setSignature(settlement.id, signature);
    this.logger.log(`Расчёт ${settlement.id} отправлен: ${signature}`);

    for (let attempt = 0; attempt < this.timing.attempts; attempt += 1) {
      const result = await this.verify({ ...settlement, signature });
      if (result) {
        return result;
      }
      await sleep(this.timing.intervalMs);
    }
    throw new ServiceUnavailableException(
      'Перевод отправлен, сеть ещё подтверждает — долги обновятся сами через минуту',
    );
  }

  /** Фоновая сверка отправленных расчётов, которые не успели подтвердиться при отправке */
  async checkSubmitted(limit = 10): Promise<void> {
    const ids = await this.repository.dueSubmitted(
      limit,
      new Date(Date.now() - 5_000),
    );
    for (const id of ids) {
      const settlement = await this.repository.find(id);
      if (settlement?.signature) {
        await this.verify(settlement).catch((error: unknown) =>
          this.logger.warn(
            `Сверка расчёта ${id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
  }

  /**
   * null — ещё не подтверждено. Подтверждено — засчитываем переводы, которые сеть
   * действительно провела: баланс токена у получателя вырос не меньше чем на сумму.
   */
  private async verify(
    settlement: SettlementRecord & { signature: string | null },
  ): Promise<SettlementResult | null> {
    const signature = settlement.signature;
    if (!signature) {
      return null;
    }
    const status = await this.lookup.getConfirmation(signature);
    if (status === 'pending') {
      return null;
    }
    if (status === 'failed') {
      await this.repository.markFailed(settlement.id);
      throw new UnprocessableEntityException('Сеть Solana отклонила перевод');
    }
    const received = await this.lookup.receivedBy(signature, settlement.mint);
    if (!received) {
      return null;
    }
    const verified = settlement.transfers.filter(
      (transfer) =>
        (received.get(transfer.address) ?? 0n) >=
        BigInt(transfer.amountCents) * RAW_UNITS_PER_CENT,
    );
    if (verified.length === 0) {
      await this.repository.markFailed(settlement.id);
      throw new UnprocessableEntityException(
        'Транзакция прошла, но переводов по расчёту в ней нет',
      );
    }
    await this.repository.confirm(settlement, verified, signature, new Date());
    this.logger.log(
      `Расчёт ${settlement.id} подтверждён: ${verified.length} из ${settlement.transfers.length}`,
    );
    return {
      settlementId: settlement.id,
      signature,
      status,
      token: settlement.token,
      transfers: verified.map(toView),
      total: totalOf(verified),
    };
  }
}

const toView = (transfer: {
  memberId: string;
  name: string;
  address: string;
  amountCents: number;
}): TransferView => ({
  memberId: transfer.memberId,
  name: transfer.name,
  address: transfer.address,
  amount: transfer.amountCents / 100,
});

const totalOf = (transfers: ReadonlyArray<{ amountCents: number }>): number =>
  transfers.reduce((sum, transfer) => sum + transfer.amountCents, 0) / 100;
