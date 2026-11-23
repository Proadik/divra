import { z } from 'zod'
import { FIAT_CURRENCIES } from '@/shared/config'

/** Суммы приходят числом в единицах валюты группы (USDC), не в минимальных единицах. */
const amount = z.number().nonnegative()

/** Сравнение сумм в центах, чтобы не споткнуться о 0.1 + 0.2 */
const toCents = (value: number): number => Math.round(value * 100)

export const memberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  initials: z.string().min(1).max(2),
  /** true — это текущий пользователь */
  isMe: z.boolean(),
  /**
   * active — подтвердил кошелёк; pending — добавлен по имени, кошелька пока нет.
   * pending участвует в расходах и долгах, но перевести ему USDC нельзя.
   */
  status: z.enum(['active', 'pending']),
  /** Адрес кошелька. null — кошелька нет (pending) или это ты сам */
  address: z.string().nullable().default(null),
})

export const expenseCategorySchema = z.enum([
  'transport',
  'housing',
  'food',
  'groceries',
  'fun',
  'other',
])

/** Тип группы — от него иконка в списке */
export const groupKindSchema = z.enum(['trip', 'home', 'food', 'other'])

export const splitModeSchema = z.enum(['equal', 'exact', 'percent', 'shares'])

/** Как расход ввели: сумма в фиате и курс к доллару на момент записи */
export const originalAmountSchema = z.object({
  currency: z.enum(FIAT_CURRENCIES),
  amount: z.number().positive(),
  /** Единиц валюты за 1 USD */
  rate: z.number().positive(),
})

/**
 * То же при чтении: валюта — любой код ISO 4217. Расходы, записанные в валюте, которую
 * приложение больше не предлагает для ввода (например, EUR), продолжают открываться.
 */
const storedOriginalAmountSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount: z.number().positive(),
  /** Единиц валюты за 1 USD */
  rate: z.number().positive(),
})

export const expenseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: expenseCategorySchema,
  paidById: z.string().min(1),
  amount,
  /** Доля текущего пользователя в этом расходе */
  myShare: amount,
  /** null — вводили сразу в долларах */
  original: storedOriginalAmountSchema.nullable().default(null),
  createdAt: z.iso.datetime(),
  /** Можешь ли ты править и удалять: ты автор расхода или его плательщик */
  canEdit: z.boolean().default(false),
})

/** Расход для формы правки: доли всех участников */
export const expenseDetailSchema = expenseSchema.extend({
  splitMode: splitModeSchema,
  shares: z.array(z.object({ memberId: z.string().min(1), amount })),
  updatedAt: z.iso.datetime().nullable(),
})

export const groupOverviewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: groupKindSchema,
  currency: z.literal('USDC'),
  members: z.array(memberSchema).min(1),
  /** Чистый баланс текущего пользователя: > 0 — ему должны, < 0 — должен он */
  myBalance: z.number(),
  /** Переводы с участием текущего пользователя (после взаимозачёта) */
  debts: z.array(
    z.object({
      fromId: z.string().min(1),
      toId: z.string().min(1),
      amount,
    }),
  ),
  /** Сколько переводов было бы без взаимозачёта */
  transfersBeforeSimplify: z.number().int().nonnegative(),
  expenses: z.array(expenseSchema),
})

export const createExpenseRequestSchema = z
  .object({
    title: z.string().trim().min(1, 'Напиши, на что потратили').max(60, 'Не длиннее 60 символов'),
    category: expenseCategorySchema,
    paidById: z.string().min(1),
    amount: z
      .number()
      .positive('Сумма должна быть больше нуля')
      .max(1_000_000, 'Сумма больше 1 000 000 — проверь ввод'),
    /** Как делили — сохраняется, чтобы форма редактирования показала исходный ввод */
    splitMode: splitModeSchema,
    /** Сумма в валюте ввода; без неё — вводили в долларах */
    original: originalAmountSchema.optional(),
    /** Итоговые доли в USDC. Сумма долей равна сумме расхода — бэкенд перепроверяет. */
    shares: z
      .array(z.object({ memberId: z.string().min(1), amount }))
      .min(1, 'Выбери хотя бы одного участника'),
  })
  .refine(
    (value) =>
      value.shares.reduce((sum, share) => sum + toCents(share.amount), 0) === toCents(value.amount),
    { message: 'Сумма долей не равна сумме расхода', path: ['shares'] },
  )

const personSchema = z.object({
  name: z.string().min(1),
  initials: z.string().min(1).max(2),
  isMe: z.boolean(),
})

/** Строка списка групп на главной */
export const groupSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: groupKindSchema,
  membersCount: z.number().int().positive(),
  /** > 0 — тебе должны в этой группе, < 0 — должен ты */
  myBalance: z.number(),
  lastActivityAt: z.iso.datetime(),
})

/** Событие ленты «Недавнее»: расход, перевод в сети или возврат наличными */
export const activitySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['expense', 'payment', 'cash']),
  groupId: z.string().min(1),
  groupName: z.string().min(1),
  /** expense — кто платил; payment и cash — кто вернул */
  actor: personSchema,
  /** payment — кому перевели; у расхода null */
  counterpart: personSchema.nullable(),
  /** Название расхода; у перевода null */
  title: z.string().nullable(),
  /** Как событие изменило твой баланс: > 0 — в твою пользу */
  myDelta: z.number(),
  /** Перевод: подпись транзакции в сети — ссылка в обозреватель; у расхода null */
  signature: z.string().nullable().default(null),
  createdAt: z.iso.datetime(),
})

/** Главная: итог по всем группам, список групп, недавнее */
export const homeOverviewSchema = z.object({
  currency: z.literal('USDC'),
  /** Сколько тебе должны во всех группах вместе */
  owedToMe: amount,
  /** Сколько должен ты */
  iOwe: amount,
  groups: z.array(groupSummarySchema),
  activity: z.array(activitySchema),
})

export const createGroupRequestSchema = z.object({
  name: z.string().trim().min(1, 'Назови группу').max(40, 'Не длиннее 40 символов'),
  kind: groupKindSchema,
})

/** Выйти из группы или удалить участника: left — ушёл ты сам */
export const removeMemberResponseSchema = z.object({ left: z.boolean() })

export type GroupMember = z.infer<typeof memberSchema>
export type OriginalAmount = z.infer<typeof originalAmountSchema>
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>
export type GroupKind = z.infer<typeof groupKindSchema>
export type GroupSummary = z.infer<typeof groupSummarySchema>
export type Activity = z.infer<typeof activitySchema>
export type HomeOverview = z.infer<typeof homeOverviewSchema>
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>
export type SplitMode = z.infer<typeof splitModeSchema>
export type GroupOverview = z.infer<typeof groupOverviewSchema>
export type GroupDebt = GroupOverview['debts'][number]
export type GroupExpense = z.infer<typeof expenseSchema>
export type ExpenseDetail = z.infer<typeof expenseDetailSchema>
export type CreateExpenseRequest = z.infer<typeof createExpenseRequestSchema>
