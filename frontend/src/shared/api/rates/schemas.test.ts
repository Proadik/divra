import { ratesSchema } from './schemas'
import { describe, expect, it } from 'vitest'

const updatedAt = '2026-11-17T12:00:00.000Z'

describe('ratesSchema', () => {
  it('без курса одной валюты остальные остаются, USD всегда 1', () => {
    const parsed = ratesSchema.parse({ base: 'USD', rates: { KZT: 515.4, RUB: 81.2 }, updatedAt })

    expect(parsed.rates).toEqual({ USD: 1, KZT: 515.4, RUB: 81.2 })
    expect(parsed.rates).not.toHaveProperty('EUR')
  })

  it('отбрасывает неизвестные валюты и мусорные значения', () => {
    const parsed = ratesSchema.parse({
      base: 'USD',
      rates: { KZT: 515.4, JPY: 155, EUR: -1, CNY: 'seven' },
      updatedAt,
    })

    expect(parsed.rates).toEqual({ USD: 1, KZT: 515.4 })
  })
})
