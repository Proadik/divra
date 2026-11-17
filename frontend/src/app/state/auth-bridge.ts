import { useWalletSession } from '@/entities/wallet'
import { configureAuth, refreshAccessToken } from '@/shared/api'

/**
 * Связывает API-клиент (shared) с сессией (entities): клиент берёт access-токен из стора,
 * при 401 обновляет его по refresh-cookie, а если не вышло — сессия истекает и
 * пользователь подписывает вход заново. Вызывается один раз при старте приложения.
 */
export const connectApiToSession = (): void => {
  configureAuth({
    getToken: () => useWalletSession.getState().sessionToken,
    refresh: async () => {
      try {
        const { accessToken } = await refreshAccessToken()
        useWalletSession.getState().tokenRefreshed(accessToken)
        return accessToken
      } catch {
        return null
      }
    },
    onExpired: () => useWalletSession.getState().sessionExpired(),
  })
}
