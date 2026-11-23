import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useWalletSession } from '@/entities/wallet'
import {
  type ServerEvent,
  connectEvents,
  groupKeys,
  historyKeys,
  paymentKeys,
  refreshAccessToken,
  transferKeys,
} from '@/shared/api'

/**
 * События с бэкенда → кэш TanStack Query. Событие говорит только «что изменилось»: мы помечаем
 * эти данные устаревшими, и открытые экраны сами перезапрашивают их обычными запросами.
 * Соединение живёт, пока есть сессия. Токен истёк — обновляем его и переподключаемся.
 */
export const ServerEventsSync = (): null => {
  const queryClient = useQueryClient()
  const hasSession = useWalletSession((state) => state.sessionToken !== null)

  useEffect(() => {
    if (!hasSession) {
      return
    }
    const onEvent = (event: ServerEvent): void => {
      switch (event.type) {
        case 'group.changed':
          void queryClient.invalidateQueries({ queryKey: groupKeys.all })
          void queryClient.invalidateQueries({ queryKey: paymentKeys.sent(event.groupId) })
          void queryClient.invalidateQueries({ queryKey: transferKeys.all })
          void queryClient.invalidateQueries({ queryKey: historyKeys.all })
          return
        case 'transfer.detected':
          void queryClient.invalidateQueries({ queryKey: transferKeys.all })
          void queryClient.invalidateQueries({ queryKey: historyKeys.all })
          return
        case 'history.changed':
          void queryClient.invalidateQueries({ queryKey: historyKeys.all })
      }
    }
    const connection = connectEvents({
      getToken: () => useWalletSession.getState().sessionToken,
      onEvent,
      onUnauthorized: () => {
        // Refresh одноразовый и общий для вкладки: refreshAccessToken не даст обновить дважды
        refreshAccessToken()
          .then(({ accessToken }) => {
            useWalletSession.getState().tokenRefreshed(accessToken)
            connection.reconnect()
          })
          .catch(() => useWalletSession.getState().sessionExpired())
      },
    })
    return () => connection.close()
  }, [hasSession, queryClient])

  return null
}
