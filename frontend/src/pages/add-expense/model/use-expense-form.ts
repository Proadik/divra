import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { usePreferences } from '@/entities/currency'
import {
  type CreateExpenseRequest,
  type ExpenseCategory,
  type GroupMember,
  RATES_STALE_MS,
  type SplitMode,
  createExpense,
  createExpenseRequestSchema,
  getGroupOverview,
  getRates,
  groupKeys,
  ratesKeys,
} from '@/shared/api'
import { FIAT_DECIMALS, type FiatCurrency } from '@/shared/config'
import { type SplitResult, computeSplit, distribute, toCents } from '../lib/split'
import { parseAmount, parseSplitValue } from '../lib/masks'

export type ExpenseFormValues = {
  /** Валюта, в которой вводят сумму и точные доли */
  currency: FiatCurrency
  amountText: string
  title: string
  category: ExpenseCategory
  paidById: string
  mode: SplitMode
  /** id участников, между которыми делим */
  selected: readonly string[]
  /** Сырой текст из полей по каждому участнику (для exact / percent / shares) */
  splitTexts: Readonly<Record<string, string>>
}

export type ExpenseForm = {
  members: readonly GroupMember[] | undefined
  isLoading: boolean
  values: ExpenseFormValues
  /** Доли в валюте ввода, в центах этой валюты */
  split: SplitResult
  /** Знаков после запятой у валюты ввода: тенге и рубли — 0 */
  fractionDigits: 0 | 2
  /** Единиц валюты за 1 USD; null — курс ещё не загружен или не получен */
  rate: number | null
  rateStatus: 'pending' | 'error' | 'ready'
  /** Сумма в стейблкоине, центы; null — нечего показать */
  stableCents: number | null
  /** Готовое тело запроса или первая ошибка валидации */
  payload: { ok: true; data: CreateExpenseRequest } | { ok: false; message: string | null }
  set: <K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]) => void
  toggleMember: (memberId: string) => void
  setSplitText: (memberId: string, text: string) => void
  submit: () => void
  isSubmitting: boolean
  submitError: Error | null
}

const SPLIT_MESSAGES: Record<Exclude<SplitResult, { ok: true }>['reason'], string | null> = {
  'no-amount': null,
  'no-members': 'Выбери хотя бы одного участника',
  'exact-mismatch': null,
  'percent-mismatch': null,
  'no-shares': 'Укажи доли участников',
}

export const useExpenseForm = (groupId: string, onCreated: () => void): ExpenseForm => {
  const queryClient = useQueryClient()
  const overview = useQuery({
    queryKey: groupKeys.overview(groupId),
    queryFn: () => getGroupOverview(groupId),
  })
  const members = overview.data?.members
  const me = members?.find((member) => member.isMe)

  const defaultCurrency = usePreferences((state) => state.inputCurrency)
  const [touched, setTouched] = useState<Partial<ExpenseFormValues>>({})
  // Значения по умолчанию зависят от загруженных участников, поэтому храним только изменения
  const values: ExpenseFormValues = {
    currency: defaultCurrency,
    amountText: '',
    title: '',
    category: 'food',
    paidById: me?.id ?? '',
    mode: 'equal',
    selected: members?.map((member) => member.id) ?? [],
    splitTexts: {},
    ...touched,
  }

  const set: ExpenseForm['set'] = (key, value) => {
    setTouched((prev) => ({
      ...prev,
      [key]: value,
      // Смена способа деления — старые числа в полях теряют смысл
      ...(key === 'mode' ? { splitTexts: {} } : {}),
    }))
  }

  const amount = parseAmount(values.amountText)
  const entries = (members ?? [])
    .filter((member) => values.selected.includes(member.id))
    .map((member) => ({
      memberId: member.id,
      value:
        values.mode === 'equal'
          ? 0
          : parseSplitValue(values.mode, values.splitTexts[member.id] ?? ''),
    }))
  const fractionDigits = FIAT_DECIMALS[values.currency]
  // Без копеек — делим целыми единицами валюты (шаг 100 центов)
  const split = computeSplit(toCents(amount), values.mode, entries, fractionDigits === 0 ? 100 : 1)

  const rates = useQuery({
    queryKey: ratesKeys.usd(),
    queryFn: getRates,
    staleTime: RATES_STALE_MS,
  })
  const isUsd = values.currency === 'USD'
  const rate = isUsd ? 1 : (rates.data?.rates[values.currency] ?? null)
  const rateStatusOf = (): ExpenseForm['rateStatus'] => {
    if (isUsd) {
      return 'ready'
    }
    if (rates.isPending) {
      return 'pending'
    }
    // Ошибка запроса или бэкенд не знает эту валюту
    return rate === null ? 'error' : 'ready'
  }
  const rateStatus = rateStatusOf()
  // Стейблкоин = доллар 1:1, поэтому эквивалент — это сумма в долларах по курсу
  const stableCents = rate && amount > 0 ? Math.round(toCents(amount) / rate) : null

  const buildPayload = (): ExpenseForm['payload'] => {
    if (!split.ok) {
      return { ok: false, message: SPLIT_MESSAGES[split.reason] }
    }
    if (!rate || stableCents === null) {
      return {
        ok: false,
        message: rateStatus === 'error' ? 'Не удалось получить курс. Попробуй позже.' : null,
      }
    }
    if (stableCents === 0) {
      return { ok: false, message: 'Сумма меньше одного цента в долларах' }
    }
    // Доли переводим тем же способом, что и делили: сумма долей = сумме расхода до цента
    const stableShares = distribute(
      stableCents,
      split.shares.map((share) => share.cents),
    )
    const parsed = createExpenseRequestSchema.safeParse({
      title: values.title,
      category: values.category,
      paidById: values.paidById,
      amount: stableCents / 100,
      ...(isUsd ? {} : { original: { currency: values.currency, amount, rate } }),
      splitMode: values.mode,
      shares: split.shares.map((share, index) => ({
        memberId: share.memberId,
        amount: (stableShares[index] ?? 0) / 100,
      })),
    })
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, message: values.title ? (parsed.error.issues[0]?.message ?? null) : null }
  }
  const payload = buildPayload()

  const mutation = useMutation({
    mutationKey: ['expenses', 'create', groupId],
    mutationFn: (data: CreateExpenseRequest) => createExpense(groupId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: groupKeys.all })
      onCreated()
    },
  })

  return {
    members,
    isLoading: overview.isPending,
    values,
    split,
    fractionDigits,
    rate,
    rateStatus,
    stableCents,
    payload,
    set,
    toggleMember: (memberId) =>
      set(
        'selected',
        values.selected.includes(memberId)
          ? values.selected.filter((id) => id !== memberId)
          : [...values.selected, memberId],
      ),
    setSplitText: (memberId, text) => set('splitTexts', { ...values.splitTexts, [memberId]: text }),
    submit: () => {
      if (payload.ok && !mutation.isPending) {
        mutation.mutate(payload.data)
      }
    },
    isSubmitting: mutation.isPending,
    submitError: mutation.error,
  }
}
