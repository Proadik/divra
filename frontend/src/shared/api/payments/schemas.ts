import { z } from 'zod'
import { STABLECOINS } from '@/shared/config'

const amount = z.number().positive()
const stablecoin = z.enum(STABLECOINS)
const toCents = (value: number): number => Math.round(value * 100)

/** Сколько стейблкоинов в кошельке (в единицах токена) */
export const walletBalancesSchema = z.object(
  Object.fromEntries(STABLECOINS.map((coin) => [coin, z.number().nonnegative()])) as Record<
    (typeof STABLECOINS)[number],
    z.ZodNumber
  >,
)

// ── Рассчитаться ────────────────────────────────────────────────────────────

export const prepareSettlementRequestSchema = z.object({
  token: stablecoin,
  /** Кто платит — адрес кошелька сессии */
  payer: z.string().min(1),
  transfers: z
    .array(z.object({ memberId: z.string().min(1), amount }))
    .min(1, 'Выбери, кому перевести'),
})

const transferSchema = z.object({
  memberId: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  amount,
})

/** Бэкенд собрал транзакцию: один перевод на каждого получателя, одна подпись */
export const preparedSettlementSchema = z
  .object({
    settlementId: z.string().min(1),
    chain: z.literal('solana'),
    token: stablecoin,
    /** Неподписанная транзакция, base64 (wire format) */
    transaction: z.string().min(1),
    transfers: z.array(transferSchema).min(1),
    total: amount,
    expiresAt: z.iso.datetime(),
  })
  .refine(
    (value) =>
      value.transfers.reduce((sum, item) => sum + toCents(item.amount), 0) === toCents(value.total),
    { message: 'Сумма переводов не равна итогу' },
  )

export const submitSettlementRequestSchema = z.object({
  settlementId: z.string().min(1),
  /** Подписанная транзакция, base64 */
  signedTransaction: z.string().min(1),
})

export const settlementResultSchema = z.object({
  settlementId: z.string().min(1),
  /** Подпись транзакции в сети — по ней ищут в обозревателе */
  signature: z.string().min(1),
  status: z.enum(['confirmed', 'finalized']),
  token: stablecoin,
  transfers: z.array(transferSchema).min(1),
  total: amount,
})

// ── Запросить ───────────────────────────────────────────────────────────────

export const createPaymentRequestsSchema = z.object({
  token: stablecoin,
  /** Куда платить — адрес кошелька сессии */
  recipient: z.string().min(1),
  memberIds: z.array(z.string().min(1)).min(1, 'Выбери, у кого запросить'),
  message: z.string().trim().max(140, 'Не длиннее 140 символов'),
  /** Через сколько дней напомнить; null — не напоминать */
  remindInDays: z.number().int().positive().nullable(),
})

export const paymentRequestSchema = z.object({
  code: z.string().min(8),
  memberId: z.string().min(1),
  memberName: z.string().min(1),
  amount,
  token: stablecoin,
  /** Страница запроса в Divra — её отправляют другу */
  url: z.url(),
  /** Ссылка Solana Pay: её понимают кошельки, она же в QR */
  solanaPayUrl: z.string().startsWith('solana:'),
})

/** Мой запрос в списке «Отправленные»: статус и та же ссылка / QR, чтобы напомнить */
export const sentPaymentRequestSchema = paymentRequestSchema.extend({
  /** open — ждёт оплаты; paid — перевод найден в сети; expired — ссылка больше не работает */
  status: z.enum(['open', 'paid', 'expired']),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
  /** Транзакция, которой запрос оплачен */
  signature: z.string().nullable().default(null),
})

/** Что видит друг по ссылке, без входа */
export const paymentRequestPreviewSchema = z.object({
  code: z.string().min(8),
  fromName: z.string().min(1),
  fromAddress: z.string().min(1),
  toName: z.string().min(1),
  groupName: z.string().min(1),
  amount,
  token: stablecoin,
  message: z.string(),
  solanaPayUrl: z.string().startsWith('solana:'),
  expiresAt: z.iso.datetime(),
  /** paid — бэкенд нашёл перевод в сети по reference */
  status: z.enum(['open', 'paid']).default('open'),
  paidAt: z.iso.datetime().nullable().default(null),
  /** Транзакция, которой запрос оплачен — её бэкенд нашёл в сети по reference */
  signature: z.string().nullable().default(null),
})

/** Перевод по запросу, собранный бэкендом для кошелька плательщика */
export const paymentTransactionSchema = z.object({
  /** Неподписанная транзакция, base64 (wire format) */
  transaction: z.string().min(1),
  /** Что показать рядом: группа, сумма, получатель */
  message: z.string(),
})

export const submittedPaymentSchema = z.object({ signature: z.string().min(1) })

export type PaymentTransaction = z.infer<typeof paymentTransactionSchema>
export type WalletBalances = z.infer<typeof walletBalancesSchema>
export type PrepareSettlementRequest = z.infer<typeof prepareSettlementRequestSchema>
export type PreparedSettlement = z.infer<typeof preparedSettlementSchema>
export type SubmitSettlementRequest = z.infer<typeof submitSettlementRequestSchema>
export type SettlementResult = z.infer<typeof settlementResultSchema>
export type CreatePaymentRequests = z.infer<typeof createPaymentRequestsSchema>
export type PaymentRequest = z.infer<typeof paymentRequestSchema>
export type PaymentRequestPreview = z.infer<typeof paymentRequestPreviewSchema>
export type SentPaymentRequest = z.infer<typeof sentPaymentRequestSchema>
