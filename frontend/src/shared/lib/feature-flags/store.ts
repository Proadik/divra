import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { FEATURE_FLAGS, FLAG_NAMES, type FlagName, isFlagName } from '@/shared/config'

export type FlagValues = Partial<Record<FlagName, boolean>>

type FeatureFlagsState = {
  /** Значения из источника. Нет ключа — действует дефолт из FEATURE_FLAGS. */
  values: FlagValues
  /** Источник хотя бы раз ответил в этой вкладке */
  loaded: boolean
  /**
   * Принять ответ источника. Возвращает флаги, у которых изменилось итоговое значение, —
   * по ним app сбрасывает кэш запросов.
   */
  apply: (raw: unknown) => FlagName[]
}

const effective = (values: FlagValues, name: FlagName): boolean =>
  values[name] ?? FEATURE_FLAGS[name].default

/** Из ответа берём только известные флаги с булевым значением, остальное игнорируем. */
export const parseFlagValues = (raw: unknown): FlagValues => {
  const values: FlagValues = {}
  if (raw && typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw)) {
      if (isFlagName(name) && typeof value === 'boolean') {
        values[name] = value
      }
    }
  }
  return values
}

/**
 * Последние известные значения кэшируются: после перезагрузки первые запросы
 * идут туда же, куда шли, а не по дефолтам — пока источник не ответит.
 */
export const useFeatureFlagsStore = create<FeatureFlagsState>()(
  persist(
    (set, get) => ({
      values: {},
      loaded: false,
      apply: (raw) => {
        const prev = get().values
        const next = parseFlagValues(raw)
        const changed = FLAG_NAMES.filter((name) => effective(prev, name) !== effective(next, name))
        set({ values: next, loaded: true })
        return changed
      },
    }),
    {
      name: 'divra.flags-cache',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ values }) => ({ values }),
      merge: (persisted, current) => ({
        ...current,
        values: parseFlagValues((persisted as { values?: unknown } | undefined)?.values),
      }),
    },
  ),
)

/** Вне React: API-функции читают флаг в момент запроса, поэтому смена действует сразу. */
export const isFlagOn = (name: FlagName): boolean =>
  effective(useFeatureFlagsStore.getState().values, name)

/** В компонентах: перерисовка при смене флага. */
export const useFlag = (name: FlagName): boolean =>
  useFeatureFlagsStore((state) => effective(state.values, name))
