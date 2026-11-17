import { z } from 'zod'
import { FIAT_CURRENCIES, type FiatCurrency } from '@/shared/config'

const isKnown = (code: string): code is FiatCurrency =>
  (FIAT_CURRENCIES as readonly string[]).includes(code)

/**
 * Сколько единиц валюты стоит 1 USD.
 *
 * Схема терпимая: лишние валюты отбрасываются, недостающих просто нет в результате.
 * Так фронтенд с новой валютой можно выкатить раньше бэкенда — без курса отключится
 * только она, остальные продолжат работать. USD всегда 1, даже если бэкенд его не прислал.
 */
export const ratesSchema = z.object({
  base: z.literal('USD'),
  rates: z
    .record(z.string(), z.unknown())
    .transform((raw): Partial<Record<FiatCurrency, number>> => {
      const known: Partial<Record<FiatCurrency, number>> = { USD: 1 }
      for (const [code, value] of Object.entries(raw)) {
        if (isKnown(code) && typeof value === 'number' && Number.isFinite(value) && value > 0) {
          known[code] = value
        }
      }
      return known
    }),
  updatedAt: z.iso.datetime(),
})

export type Rates = z.infer<typeof ratesSchema>
