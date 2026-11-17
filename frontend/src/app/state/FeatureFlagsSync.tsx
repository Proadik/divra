import { type QueryKey, useQueryClient } from '@tanstack/react-query'
import { type ReactElement, type ReactNode, useEffect, useState } from 'react'
import { groupKeys, inviteKeys, ratesKeys } from '@/shared/api'
import { type FlagName, env } from '@/shared/config'
import {
  flagsSource,
  startFeatureFlagsSync,
  useFeatureFlagsStore,
} from '@/shared/lib/feature-flags'

/** Какие данные перезагрузить, когда флаг поменялся: мок теперь отдаёт другой набор. */
const QUERIES_BY_FLAG: Record<FlagName, readonly QueryKey[]> = {
  'mock.groups': [groupKeys.all, inviteKeys.all],
  'mock.rates': [ratesKeys.all],
}

/** Сколько ждать флаги при старте, прежде чем показать приложение на кэше/дефолтах */
const FIRST_LOAD_TIMEOUT_MS = 1_500

/**
 * Синхронизация фича-флагов: держит их свежими и при смене сбрасывает кэш затронутых
 * запросов — экраны тут же перезапрашивают данные уже из нового источника.
 *
 * Дети рендерятся после первого ответа источника (или по таймауту), чтобы первые
 * запросы не ушли не туда.
 */
export const FeatureFlagsSync = ({ children }: { children: ReactNode }): ReactElement | null => {
  const queryClient = useQueryClient()
  const loaded = useFeatureFlagsStore((state) => state.loaded)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const stop = startFeatureFlagsSync({
      source: flagsSource,
      pollMs: env.FLAGS_POLL_MS,
      onChange: (changed) => {
        for (const name of changed) {
          for (const queryKey of QUERIES_BY_FLAG[name]) {
            // reset, а не invalidate: данные из другого набора показывать нельзя даже секунду
            void queryClient.resetQueries({ queryKey })
          }
        }
      },
    })
    const timer = window.setTimeout(() => setTimedOut(true), FIRST_LOAD_TIMEOUT_MS)
    return () => {
      stop()
      window.clearTimeout(timer)
    }
  }, [queryClient])

  return loaded || timedOut ? <>{children}</> : null
}
