import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { address, getAddressDecoder } from '@solana/kit';
import { BlockhashSource } from '../auth/solana/blockhash.source.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { GroupsService } from '../groups/groups.service.js';
import { UsersRepository } from '../users/repositories/users.repository.js';
import type {
  PaymentRequestPreview,
  PaymentRequestView,
  SentPaymentRequest,
} from './payment.interface.js';
import {
  type CreatePaymentRequests,
  PAYMENT_CODE,
} from './payments.schemas.js';
import {
  buildPaymentTransaction,
  isPaymentTransaction,
  recipientTokenAccount,
} from './solana/payment-transaction.js';
import { TransactionSender } from './solana/transaction-sender.js';
import {
  type PaymentRequestDetails,
  type PaymentRequestRecord,
  PaymentsRepository,
} from './repositories/payments.repository.js';
import { PaymentLookup } from './solana/payment-lookup.js';
import { RAW_UNITS_PER_CENT, stablecoinMint } from './solana/stablecoins.js';

/** Сколько живёт ссылка на оплату */
const REQUEST_TTL_MS = 14 * 24 * 3_600_000;
/** Сколько последних запросов показывать в «Отправленных» */
const SENT_LIMIT = 50;
/** Не чаще раза в столько искать оплату при открытии страницы */
const RECHECK_MS = 10_000;

const requestNotFound = (): NotFoundException =>
  new NotFoundException('Запрос не найден');

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly groups: GroupsService,
    private readonly users: UsersRepository,
    private readonly repository: PaymentsRepository,
    private readonly lookup: PaymentLookup,
    private readonly blockhashes: BlockhashSource,
    private readonly sender: TransactionSender,
  ) {}

  /**
   * Перевод по запросу для кошелька плательщика: на странице оплаты его подписывает
   * расширение (Phantom не открывает ссылки solana: на компьютере). Сумма, получатель,
   * токен и reference — из запроса, от клиента только адрес плательщика.
   */
  async buildTransaction(
    code: string,
    account: string,
  ): Promise<{ transaction: string; message: string }> {
    const request = await this.findOpen(code);
    if (account === request.recipient) {
      throw new UnprocessableEntityException('Это кошелёк получателя');
    }
    const transaction = await buildPaymentTransaction({
      payer: address(account),
      recipient: address(request.recipient),
      mint: address(request.mint),
      rawAmount: BigInt(request.amountCents) * RAW_UNITS_PER_CENT,
      reference: address(request.reference),
      blockhash: await this.blockhashes.latest(),
    });
    return {
      transaction,
      message: `${request.groupName}: ${(request.amountCents / 100).toFixed(2)} ${request.token} для ${request.requesterName}`,
    };
  }

  /**
   * Отправляет подписанный перевод в сеть. Засчитает его не этот вызов, а поиск по reference
   * после подтверждения — так же, как оплату по QR.
   */
  async submit(
    code: string,
    signedTransaction: string,
  ): Promise<{ signature: string }> {
    const request = await this.findOpen(code);
    const destination = await recipientTokenAccount(
      address(request.recipient),
      address(request.mint),
    );
    if (
      !isPaymentTransaction(signedTransaction, {
        reference: address(request.reference),
        destination,
      })
    ) {
      throw new BadRequestException('Это не перевод по этому запросу');
    }
    const signature = await this.sender.send(signedTransaction);
    await this.repository.markChecked(request.id, null);
    this.logger.log(`Запрос ${request.id}: перевод отправлен ${signature}`);
    return { signature };
  }

  private async findOpen(code: string): Promise<PaymentRequestDetails> {
    if (!PAYMENT_CODE.test(code)) {
      throw requestNotFound();
    }
    const request = await this.repository.findByCode(code);
    if (!request) {
      throw requestNotFound();
    }
    if (request.paidAt) {
      throw new ConflictException('Запрос уже оплачен');
    }
    if (request.replacedAt) {
      throw new GoneException('Запрос заменён новым — попроси свежую ссылку');
    }
    if (request.expiresAt <= new Date()) {
      throw new GoneException('Срок запроса истёк');
    }
    return request;
  }

  /**
   * По запросу на каждого выбранного должника — на всю сумму его долга.
   * Сумму считает сервер по расходам: клиент только выбирает, у кого запросить.
   */
  async createRequests(
    groupId: string,
    userId: string,
    input: CreatePaymentRequests,
  ): Promise<PaymentRequestView[]> {
    const ledger = await this.groups.ledgerFor(groupId, userId);
    if (!ledger) {
      throw new NotFoundException('Группа не найдена');
    }
    // Деньги придут только на свой кошелёк: иначе запросом можно перенаправить чужой долг
    const profile = await this.users.getProfile(userId);
    const ownsRecipient = profile?.wallets.some(
      (wallet) =>
        wallet.chain === 'solana' && wallet.address === input.recipient,
    );
    if (!ownsRecipient) {
      throw new UnprocessableEntityException('Это не твой кошелёк');
    }
    const mint = stablecoinMint(this.config.SOLANA_CLUSTER, input.token);
    if (!mint) {
      throw new BadRequestException(
        `${input.token} нет в этой сети Solana — выбери другой стейблкоин`,
      );
    }

    const now = new Date();
    const drafts = input.memberIds.map((memberId) => {
      const debtor = ledger.members.find((member) => member.id === memberId);
      if (!debtor) {
        throw new UnprocessableEntityException('Участник не из этой группы');
      }
      const owed = ledger.debts.find(
        (debt) => debt.fromId === memberId && debt.toId === ledger.me.id,
      );
      if (!owed) {
        throw new ConflictException(
          `${debtor.displayName} тебе ничего не должен`,
        );
      }
      return {
        debtor,
        request: {
          code: randomBytes(16).toString('base64url'),
          groupId,
          requesterMemberId: ledger.me.id,
          debtorMemberId: memberId,
          createdBy: userId,
          recipient: input.recipient,
          token: input.token,
          mint,
          amountCents: owed.cents,
          // Случайный публичный ключ без приватного: только метка для поиска транзакции
          reference: getAddressDecoder().decode(randomBytes(32)),
          message: input.message,
          remindInDays: input.remindInDays,
          expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
        },
      };
    });

    const created = await this.repository.createRequests(
      drafts.map((draft) => draft.request),
      now,
    );
    return created.map((request) => {
      const debtor = drafts.find(
        (draft) => draft.debtor.id === request.debtorMemberId,
      )?.debtor;
      const debtorName = debtor?.displayName ?? 'Участник';
      return {
        code: request.code,
        memberId: request.debtorMemberId,
        memberName: debtorName,
        amount: request.amountCents / 100,
        token: request.token,
        url: `${this.config.APP_ORIGIN}/r/${request.code}`,
        solanaPayUrl: this.solanaPayUrl(request, ledger.group.name, debtorName),
      };
    });
  }

  /**
   * Мои запросы в группе со статусами и ссылками — чтобы напомнить другу без нового запроса.
   * Только свои: коды ссылок других участников не раскрываются.
   */
  async sent(groupId: string, userId: string): Promise<SentPaymentRequest[]> {
    const ledger = await this.groups.ledgerFor(groupId, userId);
    if (!ledger) {
      throw new NotFoundException('Группа не найдена');
    }
    const now = new Date();
    const requests = await this.repository.listRequests(
      groupId,
      ledger.me.id,
      SENT_LIMIT,
    );
    return requests.map((request) => ({
      code: request.code,
      memberId: request.debtorMemberId,
      memberName: request.debtorName,
      amount: request.amountCents / 100,
      token: request.token,
      url: `${this.config.APP_ORIGIN}/r/${request.code}`,
      solanaPayUrl: this.solanaPayUrl(
        request,
        request.groupName,
        request.debtorName,
      ),
      status: request.paidAt
        ? 'paid'
        : request.expiresAt <= now
          ? 'expired'
          : 'open',
      createdAt: request.createdAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      paidAt: request.paidAt?.toISOString() ?? null,
      signature: request.signature,
    }));
  }

  /**
   * Публичная страница запроса. Заодно ищет оплату в сети (не чаще раза в 10 секунд),
   * чтобы друг увидел «Оплачено» сразу после перевода.
   */
  async preview(code: string): Promise<PaymentRequestPreview> {
    if (!PAYMENT_CODE.test(code)) {
      throw requestNotFound();
    }
    let request = await this.repository.findByCode(code);
    if (!request) {
      throw requestNotFound();
    }
    const now = new Date();
    if (!request.paidAt && request.replacedAt) {
      throw new GoneException('Запрос заменён новым — попроси свежую ссылку');
    }
    if (!request.paidAt && request.expiresAt <= now) {
      throw new GoneException('Срок запроса истёк');
    }
    const checkedRecently =
      request.lastCheckedAt &&
      now.getTime() - request.lastCheckedAt.getTime() < RECHECK_MS;
    if (!request.paidAt && !checkedRecently) {
      await this.check(request, now);
      request = (await this.repository.findByCode(code)) ?? request;
    }
    return {
      code: request.code,
      fromName: request.requesterName,
      fromAddress: request.recipient,
      toName: request.debtorName,
      groupName: request.groupName,
      amount: request.amountCents / 100,
      token: request.token,
      message: request.message,
      solanaPayUrl: this.solanaPayUrl(
        request,
        request.groupName,
        request.debtorName,
      ),
      expiresAt: request.expiresAt.toISOString(),
      status: request.paidAt ? 'paid' : 'open',
      paidAt: request.paidAt?.toISOString() ?? null,
      signature: request.signature,
    };
  }

  /** Фоновая проверка: самые давно не проверенные открытые запросы */
  async checkDue(limit = 25): Promise<number> {
    const due = await this.repository.dueForCheck(limit, new Date());
    let paid = 0;
    for (const request of due) {
      if (await this.check(request, new Date())) {
        paid += 1;
      }
    }
    return paid;
  }

  /**
   * Ищет перевод по reference. Засчитывается только полная сумма в нужном токене
   * на кошелёк получателя; сеть недоступна — запрос остаётся открытым до следующей попытки.
   */
  private async check(
    request: PaymentRequestRecord,
    now: Date,
  ): Promise<boolean> {
    try {
      const transfers = await this.lookup.findTransfers({
        reference: request.reference,
        recipient: request.recipient,
        mint: request.mint,
      });
      const expected = BigInt(request.amountCents) * RAW_UNITS_PER_CENT;
      for (const transfer of transfers) {
        if (transfer.rawAmount < expected) {
          continue;
        }
        const result = await this.repository.recordPayment(
          request,
          {
            signature: transfer.signature,
            // Пришло больше — засчитываем всё, что пришло: деньги у получателя
            amountCents: Number(transfer.rawAmount / RAW_UNITS_PER_CENT),
          },
          now,
        );
        if (result === 'recorded') {
          this.logger.log(
            `Запрос ${request.id} оплачен: ${transfer.signature}`,
          );
          return true;
        }
        if (result === 'already-paid') {
          return false;
        }
      }
    } catch (error) {
      this.logger.warn(
        `Не удалось проверить оплату ${request.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await this.repository.markChecked(request.id, now);
    return false;
  }

  private solanaPayUrl(
    request: Pick<
      PaymentRequestRecord,
      'recipient' | 'amountCents' | 'mint' | 'reference' | 'message'
    >,
    groupName: string,
    debtorName: string,
  ): string {
    const params = new URLSearchParams({
      amount: (request.amountCents / 100).toFixed(2),
      'spl-token': request.mint,
      reference: request.reference,
      label: 'Divra',
      message: request.message || `${groupName}: долг ${debtorName}`,
    });
    return `solana:${request.recipient}?${params.toString()}`;
  }
}
