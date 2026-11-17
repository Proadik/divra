import { isAddress } from '@solana/kit';
import { z } from 'zod';
import { STABLECOINS } from '../../database/schema/index.js';

/** Сколько переводов влезает в одну транзакцию Solana вместе с созданием токен-аккаунтов */
export const MAX_SETTLEMENT_TRANSFERS = 8;

const cents = z
  .number()
  .finite()
  .positive('Сумма должна быть больше нуля')
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
    'Не больше двух знаков после запятой',
  )
  .transform((value) => Math.round(value * 100))
  .pipe(z.number().int().max(100_000_000));

export const prepareSettlementSchema = z.strictObject({
  token: z.enum(STABLECOINS),
  /** Кошелёк, с которого платим. Должен быть твоим — проверяет сервис */
  payer: z
    .string()
    .min(32)
    .max(44)
    .refine((value) => isAddress(value), 'Некорректный адрес Solana'),
  transfers: z
    .array(z.strictObject({ memberId: z.uuid(), amount: cents }))
    .min(1, 'Выбери, кому перевести')
    .max(
      MAX_SETTLEMENT_TRANSFERS,
      `Не больше ${MAX_SETTLEMENT_TRANSFERS} получателей за раз`,
    )
    .refine(
      (items) =>
        new Set(items.map((item) => item.memberId)).size === items.length,
      'Получатель указан дважды',
    ),
});

export const submitSettlementSchema = z.strictObject({
  settlementId: z.uuid(),
  signedTransaction: z.string().min(1).max(1700),
});

export type PrepareSettlement = z.infer<typeof prepareSettlementSchema>;
export type SubmitSettlement = z.infer<typeof submitSettlementSchema>;
