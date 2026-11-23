import { z } from 'zod'

/** Перевод стейблкоина в сети с твоим участием. Контракт — backend/src/transfers/history.service.ts */
export const historyItemSchema = z.object({
  id: z.string().min(1),
  signature: z.string().min(1),
  token: z.enum(['USDC', 'USDT']),
  /** В долларах */
  amount: z.number().nonnegative(),
  /** in — пришло тебе, out — ушло от тебя */
  direction: z.enum(['in', 'out']),
  /** Другая сторона: имя в общей группе (если есть) и адрес (если известен) */
  counterparty: z.object({ name: z.string().nullable(), address: z.string().nullable() }),
  /** Группа, где перевод засчитан в долг; null — не засчитан */
  countedIn: z.string().nullable(),
  /** Перевод мимо Divra ждёт решения: засчитать или нет */
  suggested: z.boolean(),
  createdAt: z.iso.datetime(),
})

export const historyPageSchema = z.object({
  items: z.array(historyItemSchema),
  /** Курсор следующей страницы; null — дальше ничего нет */
  nextCursor: z.string().min(1).nullable(),
})

export type HistoryItem = z.infer<typeof historyItemSchema>
export type HistoryPage = z.infer<typeof historyPageSchema>
