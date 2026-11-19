import type { Stablecoin } from '../../database/schema/index.js';

export interface PaymentRequestRecord {
  id: string;
  code: string;
  groupId: string;
  requesterMemberId: string;
  debtorMemberId: string;
  recipient: string;
  token: Stablecoin;
  mint: string;
  amountCents: number;
  reference: string;
  message: string;
  createdAt: Date;
  expiresAt: Date;
  lastCheckedAt: Date | null;
  paidAt: Date | null;
  /** Заменён более новым запросом тому же должнику (или отменён) */
  replacedAt: Date | null;
  /** Отменён получателем, при выходе из группы или частичной оплатой наличными */
  cancelledAt: Date | null;
  lastRemindedAt: Date | null;
}

export type NewPaymentRequest = Omit<
  PaymentRequestRecord,
  | 'id'
  | 'createdAt'
  | 'lastCheckedAt'
  | 'paidAt'
  | 'replacedAt'
  | 'cancelledAt'
  | 'lastRemindedAt'
> & { createdBy: string; remindInDays: number | null };

/** Запрос с именами — для публичной страницы */
export interface PaymentRequestDetails extends PaymentRequestRecord {
  groupName: string;
  requesterName: string;
  debtorName: string;
  /** Подпись транзакции, которой запрос оплачен; null — не оплачен */
  signature: string | null;
}

export type RecordPaymentResult =
  /** Оплата записана, долг уменьшен */
  | 'recorded'
  /** Запрос уже оплачен раньше (другим вызовом) */
  | 'already-paid'
  /** Эта транзакция уже засчитана другому запросу */
  | 'signature-used';

export type CancelRequestResult = 'cancelled' | 'not-found' | 'paid';

export type RemindResult =
  | { ok: true; request: PaymentRequestDetails }
  | { ok: false; reason: 'not-found' | 'not-open' }
  | { ok: false; reason: 'too-soon'; nextAt: Date };

export type RecordCashResult =
  | { ok: true; remainingCents: number; closedRequest: boolean }
  | {
      ok: false;
      reason: 'not-member' | 'foreign-member' | 'no-debt' | 'too-much';
      owedCents?: number;
    };

export abstract class PaymentsRepository {
  /**
   * Один действующий запрос на пару «кто просит → кто должен». Есть действующий с той же
   * суммой, токеном, получателем и сообщением — он и возвращается; иначе старые помечаются
   * заменёнными и создаётся новый.
   */
  abstract createRequests(
    requests: NewPaymentRequest[],
    now: Date,
  ): Promise<PaymentRequestRecord[]>;

  /** Запросы requester в группе, новые сверху; заменённые — только если их всё же оплатили */
  abstract listRequests(
    groupId: string,
    requesterMemberId: string,
    limit: number,
  ): Promise<PaymentRequestDetails[]>;

  abstract findByCode(code: string): Promise<PaymentRequestDetails | undefined>;

  /** Неоплаченные и не истёкшие запросы, которые дольше всех не проверяли */
  abstract dueForCheck(
    limit: number,
    now: Date,
  ): Promise<PaymentRequestRecord[]>;

  /** at = null — проверить при следующем обращении (только что отправили перевод) */
  abstract markChecked(requestId: string, at: Date | null): Promise<void>;

  /**
   * Атомарно: перевод debtor → requester на amountCents по транзакции signature,
   * запрос — оплачен. Повтор того же запроса или той же транзакции ничего не меняет.
   */
  abstract recordPayment(
    request: PaymentRequestRecord,
    payment: { signature: string; amountCents: number },
    at: Date,
  ): Promise<RecordPaymentResult>;

  /** Отменить свой открытый запрос: ссылка ответит 410, напоминать по нему нельзя */
  abstract cancelRequest(
    groupId: string,
    requesterMemberId: string,
    code: string,
    at: Date,
  ): Promise<CancelRequestResult>;

  /**
   * Отметить напоминание по своему открытому запросу. Атомарно: не чаще раза в minIntervalMs,
   * параллельные вызовы не пройдут оба.
   */
  abstract markReminded(
    groupId: string,
    requesterMemberId: string,
    code: string,
    at: Date,
    minIntervalMs: number,
  ): Promise<RemindResult>;

  /**
   * Получатель (userId) отмечает, что debtor отдал ему amountCents вне сети. Не больше долга
   * debtor → userId после зачёта; долг проверяется под блокировкой группы. Открытый запрос
   * той же пары закрывается: полностью покрыт — оплачен этой записью, частично — отменён.
   */
  abstract recordCash(input: {
    groupId: string;
    userId: string;
    debtorMemberId: string;
    amountCents: number;
    at: Date;
  }): Promise<RecordCashResult>;
}
