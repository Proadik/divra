import { env } from '@/shared/config'
import { api } from '../client'
import { type Rates, ratesSchema } from './schemas'

/** Курсы фиата к доллару. Бэкенд кэширует их у провайдера, клиент — на RATES_STALE_MS. */
export const getRates = async (): Promise<Rates> => {
  const response = env.API_MOCK
    ? await (await import('../mock/rates')).mockRatesBackend.getRates()
    : await api.get<unknown>('/rates?base=USD')
  return ratesSchema.parse(response)
}

export const RATES_STALE_MS = 10 * 60_000

export const ratesKeys = {
  all: ['rates'] as const,
  usd: () => [...ratesKeys.all, 'USD'] as const,
}
