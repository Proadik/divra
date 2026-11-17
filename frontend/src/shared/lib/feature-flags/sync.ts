import type { FlagName } from '@/shared/config'
import type { FlagsSource } from './sources'
import { useFeatureFlagsStore } from './store'

type SyncOptions = {
  source: FlagsSource
  /** Страховочный опрос, мс */
  pollMs: number
  /** Итоговые значения этих флагов изменились */
  onChange: (changed: FlagName[]) => void
}

/**
 * Держит флаги свежими: загрузка при старте, подписка на изменения (если источник умеет),
 * опрос по таймеру и при возвращении во вкладку. Возвращает функцию остановки.
 */
export const startFeatureFlagsSync = ({ source, pollMs, onChange }: SyncOptions): (() => void) => {
  const apply = (raw: unknown): void => {
    const changed = useFeatureFlagsStore.getState().apply(raw)
    if (changed.length > 0) {
      onChange(changed)
    }
  }
  const load = (): void => {
    source.load().then(apply, () => {
      // Источник недоступен — живём на последних известных значениях
      useFeatureFlagsStore.setState({ loaded: true })
    })
  }
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') {
      load()
    }
  }

  load()
  const unsubscribe = source.subscribe?.(apply)
  const timer = window.setInterval(load, pollMs)
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    unsubscribe?.()
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
