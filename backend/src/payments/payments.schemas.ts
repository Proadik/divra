import { isAddress } from '@solana/kit';
import { z } from 'zod';
import { STABLECOINS } from '../database/schema/index.js';
import { optionalText } from '../groups/groups.schemas.js';
import { MAX_MEMBERS_PER_GROUP } from '../groups/repositories/groups.repository.js';

export const createPaymentRequestsSchema = z.strictObject({
  token: z.enum(STABLECOINS),
  /** Куда платить. Должен быть кошельком того, кто запрашивает — проверяет сервис */
  recipient: z
    .string()
    .min(32)
    .max(44)
    .refine((value) => isAddress(value), 'Некорректный адрес Solana'),
  memberIds: z
    .array(z.uuid())
    .min(1, 'Выбери, у кого запросить')
    .max(MAX_MEMBERS_PER_GROUP)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'Участник указан дважды',
    ),
  message: optionalText(140),
  remindInDays: z.number().int().min(1).max(60).nullable(),
});

const solanaAddress = z
  .string()
  .min(32)
  .max(44)
  .refine((value) => isAddress(value), 'Некорректный адрес Solana');

/** Кто платит — собрать для него перевод (как POST в Solana Pay transaction request) */
export const paymentTransactionRequestSchema = z.strictObject({
  account: solanaAddress,
});

/** Подписанный кошельком перевод. Больше пакета Solana (1232 байт) не бывает */
export const submitPaymentSchema = z.strictObject({
  signedTransaction: z.string().min(1).max(1700),
});

export type PaymentTransactionRequest = z.infer<
  typeof paymentTransactionRequestSchema
>;
export type SubmitPayment = z.infer<typeof submitPaymentSchema>;

/** Код запроса: 16 случайных байт в base64url */
export const PAYMENT_CODE = /^[\w-]{22}$/;

export type CreatePaymentRequests = z.infer<typeof createPaymentRequestsSchema>;
