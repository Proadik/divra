import { useQuery } from '@tanstack/react-query'
import { usePreferences } from './preferences-store'
import { type GroupExpense, RATES_STALE_MS, getRates, ratesKeys } from '@/shared/api'
import { FIAT_DECIMALS, FIAT_SYMBOLS, type FiatCurrency } from '@/shared/config'
import { formatAmount } from '@/shared/lib/format'

export type Money = {
  /** Подпись валюты рядом с суммой: USDC, USDT или KZT… */
  unit: string
  /** Короткая подпись у сумм в списках: ₸, ₽, €, $; у стейблкоина символа нет — его код */
  symbol: string
  /** true — суммы пересчитаны в фиат по курсу */
  isFiat: boolean
  /** Пояснение под переключателем */
  note: string | null
  /** Знаков после запятой: у стейблкоина 2, у тенге и рубля 0 */
  fractionDigits: 0 | 2
  /** Сумма с нужной точностью, без знака и валюты: «40 000», «12.50» */
  format: (value: number) => string
  fromUsd: (usd: number) => number
  /** Суммы расхода: если его вводили в этой же валюте — по курсу того дня, иначе по текущему */
  ofExpense: (expense: GroupExpense, usd: number) => number
}

const roundTo = (value: number, fractionDigits: 0 | 2): number => {
  const scale = 10 ** fractionDigits
  return Math.round(value * scale) / scale
}

/**
 * Как показывать суммы: в стейблкоине или в валюте пользователя (настройка amountsIn).
 * Используется на главной и в группе. Хранятся они в долларах (= стейблкоин 1:1),
 * в фиат пересчитываются только для отображения — долги и переводы остаются в стейблкоине.
 */
export const useMoney = (): Money => {
  const stablecoin = usePreferences((state) => state.stablecoin)
  const currency: FiatCurrency = usePreferences((state) => state.inputCurrency)
  const wantsFiat = usePreferences((state) => state.amountsIn === 'fiat')
  const rates = useQuery({
    queryKey: ratesKeys.usd(),
    queryFn: getRates,
    staleTime: RATES_STALE_MS,
    enabled: wantsFiat && currency !== 'USD',
  })
  const rate = currency === 'USD' ? 1 : (rates.data?.rates[currency] ?? null)

  if (!wantsFiat || rate === null) {
    return {
      unit: stablecoin,
      symbol: stablecoin,
      isFiat: false,
      note:
        wantsFiat && !rates.isPending
          ? `Курс ${currency} недоступен — суммы в ${stablecoin}`
          : null,
      fractionDigits: 2,
      format: (value) => formatAmount(value),
      fromUsd: (usd) => usd,
      ofExpense: (_expense, usd) => usd,
    }
  }

  const digits = FIAT_DECIMALS[currency]
  return {
    unit: currency,
    symbol: FIAT_SYMBOLS[currency],
    isFiat: true,
    note: `≈ по курсу 1 USD = ${formatAmount(rate)} ${FIAT_SYMBOLS[currency]} · расчёт в ${stablecoin}`,
    fractionDigits: digits,
    format: (value) => formatAmount(value, digits),
    fromUsd: (usd) => roundTo(usd * rate, digits),
    ofExpense: (expense, usd) => {
      const original = expense.original
      if (original?.currency !== currency) {
        return roundTo(usd * rate, digits)
      }
      return roundTo(usd === expense.amount ? original.amount : usd * original.rate, digits)
    },
  }
}
