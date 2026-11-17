import { z } from 'zod'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { FIAT_CURRENCIES, type FiatCurrency, STABLECOINS, type Stablecoin } from '@/shared/config'

/**
 * Настройки пользователя на этом устройстве. Хранятся в localStorage: это предпочтения
 * интерфейса, а не данные аккаунта, поэтому бэкенд о них не знает.
 */
export type Preferences = {
  /** В какой валюте по умолчанию вводить расходы */
  inputCurrency: FiatCurrency
  /** Каким стейблкоином рассчитываться и в чём показывать балансы */
  stablecoin: Stablecoin
  /** В чём показывать суммы в группе: в стейблкоине или в валюте ввода по курсу */
  amountsIn: AmountsIn
}

export type AmountsIn = 'stablecoin' | 'fiat'

export type PreferencesStore = Preferences & {
  setInputCurrency: (currency: FiatCurrency) => void
  setStablecoin: (coin: Stablecoin) => void
  setAmountsIn: (value: AmountsIn) => void
}

const defaults: Preferences = { inputCurrency: 'KZT', stablecoin: 'USDC', amountsIn: 'stablecoin' }

const persistedSchema = z.object({
  inputCurrency: z.enum(FIAT_CURRENCIES).catch(defaults.inputCurrency),
  stablecoin: z.enum(STABLECOINS).catch(defaults.stablecoin),
  amountsIn: z.enum(['stablecoin', 'fiat']).catch(defaults.amountsIn),
})

export const usePreferences = create<PreferencesStore>()(
  persist(
    (set) => ({
      ...defaults,
      setInputCurrency: (inputCurrency) => set({ inputCurrency }),
      setStablecoin: (stablecoin) => set({ stablecoin }),
      setAmountsIn: (amountsIn) => set({ amountsIn }),
    }),
    {
      name: 'divra.preferences',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ inputCurrency, stablecoin, amountsIn }) => ({
        inputCurrency,
        stablecoin,
        amountsIn,
      }),
      merge: (persisted, current) => {
        const parsed = persistedSchema.safeParse(persisted)
        return parsed.success ? { ...current, ...parsed.data } : current
      },
    },
  ),
)

/** Короткий хук для подписей сумм: «USDC» или «USDT» */
export const useStablecoin = (): Stablecoin => usePreferences((state) => state.stablecoin)
