import type { FiatCurrency } from '@/shared/config'
import { isFlagOn } from '@/shared/lib/feature-flags'

/**
 * Имитация курсов. Значения примерные и не обновляются — только для демо.
 * Флаг mock.rates выключен — курсов нет (схема всё равно добавит USD = 1).
 */
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Record по всем валютам конфига: новая валюта без курса здесь — ошибка компиляции */
const MOCK_RATES: Record<FiatCurrency, number> = {
  KZT: 515.4,
  RUB: 81.2,
  USD: 1,
}

export const mockRatesBackend = {
  async getRates(): Promise<{
    base: 'USD'
    rates: Partial<Record<FiatCurrency, number>>
    updatedAt: string
  }> {
    await delay(200)
    return {
      base: 'USD',
      rates: isFlagOn('mock.rates') ? MOCK_RATES : {},
      updatedAt: new Date().toISOString(),
    }
  },
}
