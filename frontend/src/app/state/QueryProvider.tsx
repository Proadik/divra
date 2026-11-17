import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactElement, type ReactNode, useState } from 'react'
import { groupKeys, inviteKeys } from '@/shared/api'

/**
 * Сколько данные групп считаются свежими. Переходы группа → участники → расход берут их
 * из кэша, без запроса. Свои изменения видны сразу: мутации сбрасывают кэш групп.
 * Изменения друзей с других устройств — с задержкой до этого срока (или после F5).
 */
export const GROUPS_STALE_MS = 30_000

const createQueryClient = (): QueryClient => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  })
  client.setQueryDefaults(groupKeys.all, { staleTime: GROUPS_STALE_MS })
  client.setQueryDefaults(inviteKeys.all, { staleTime: GROUPS_STALE_MS })
  return client
}

export const QueryProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [client] = useState(createQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
