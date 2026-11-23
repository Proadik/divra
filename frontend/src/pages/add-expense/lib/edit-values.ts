import type { ExpenseDetail, GroupMember } from '@/shared/api'
import { FIAT_CURRENCIES, FIAT_DECIMALS, type FiatCurrency } from '@/shared/config'
import type { ExpenseFormValues } from '../model/use-expense-form'
import { distribute, toCents } from './split'

/** Сумма для поля с маской: «120 000», «40.5» */
export const amountText = (value: number, fractionDigits: 0 | 2): string => {
  const [whole = '0', fraction = ''] = value.toFixed(fractionDigits).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const trimmed = fraction.replace(/0+$/, '')
  return trimmed ? `${grouped}.${trimmed}` : grouped
}

const isInputCurrency = (code: string): code is FiatCurrency =>
  (FIAT_CURRENCIES as readonly string[]).includes(code)

/**
 * Начальные значения формы правки. Сумму показываем в валюте ввода по курсу, сохранённому
 * в расходе (не по сегодняшнему). «Поровну» восстанавливается как было; остальные способы —
 * точными суммами: исходные проценты и доли бэкенд не хранит, только итог в центах.
 */
export const editValuesOf = (
  expense: ExpenseDetail,
  members: readonly GroupMember[],
): { values: Partial<ExpenseFormValues>; rate: number; currency: FiatCurrency } => {
  const original =
    expense.original && isInputCurrency(expense.original.currency) ? expense.original : null
  const currency: FiatCurrency = original ? (original.currency as FiatCurrency) : 'USD'
  const rate = original?.rate ?? 1
  const fractionDigits = FIAT_DECIMALS[currency]
  const amount = original?.amount ?? expense.amount
  const known = new Set(members.map((member) => member.id))
  const shares = expense.shares.filter((share) => share.amount > 0 && known.has(share.memberId))
  const selected = shares.map((share) => share.memberId)

  const base: Partial<ExpenseFormValues> = {
    currency,
    amountText: amountText(amount, fractionDigits),
    title: expense.title,
    category: expense.category,
    paidById: expense.paidById,
    selected,
  }
  if (expense.splitMode === 'equal') {
    return { values: { ...base, mode: 'equal', splitTexts: {} }, rate, currency }
  }
  // Доли в долларах → в валюте ввода тем же способом, каким делили: сумма сходится до копейки
  const step = fractionDigits === 0 ? 100 : 1
  const parts = distribute(
    Math.round(toCents(amount) / step),
    shares.map((share) => toCents(share.amount)),
  )
  const splitTexts = Object.fromEntries(
    shares.map((share, index) => [
      share.memberId,
      amountText(((parts[index] ?? 0) * step) / 100, fractionDigits),
    ]),
  )
  return { values: { ...base, mode: 'exact', splitTexts }, rate, currency }
}
