import { z } from 'zod'

const stablecoin = z.enum(['USDC', 'USDT'])
const amount = z.number().nonnegative()

/**
 * Перевод стейблкоина от участника общей группы, сделанный мимо Divra (из кошелька напрямую).
 * Бэкенд заметил его в сети (поток LaserStream) и предлагает засчитать как возврат долга.
 */
export const detectedTransferSchema = z.object({
  id: z.string().min(1),
  signature: z.string().min(1),
  token: stablecoin,
  /** Сколько пришло, в долларах */
  amount: amount.positive(),
  /** Кто перевёл — его имя в группе с самым большим долгом */
  fromName: z.string().min(1),
  createdAt: z.iso.datetime(),
  /** Где он сейчас должен тебе — туда можно засчитать; первая — с самым большим долгом */
  groups: z
    .array(z.object({ groupId: z.string().min(1), groupName: z.string().min(1), owed: amount }))
    .min(1),
})

export const applyTransferRequestSchema = z.object({ groupId: z.string().min(1) })

export const appliedTransferSchema = z.object({
  groupId: z.string().min(1),
  /** Сколько засчитано (не больше долга) */
  amount,
  /** Сколько ещё должен */
  remaining: amount,
})

export type DetectedTransfer = z.infer<typeof detectedTransferSchema>
export type AppliedTransfer = z.infer<typeof appliedTransferSchema>
