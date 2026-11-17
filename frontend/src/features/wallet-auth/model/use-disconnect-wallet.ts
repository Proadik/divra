import { useQueryClient } from '@tanstack/react-query'
import { useWalletSession } from '@/entities/wallet'
import { authKeys, signOutSession } from '@/shared/api'
import { getWalletAdapter } from '@/shared/lib/wallets'

/**
 * Выход: бэкенд отзывает refresh-токен и стирает cookie, затем чистим сессию, кэш
 * и отключаем кошелёк. Если сеть недоступна — всё равно выходим локально:
 * токен в памяти пропадёт, а refresh-cookie истечёт сама.
 */
export const useDisconnectWallet = (): (() => Promise<void>) => {
  const queryClient = useQueryClient()
  return async () => {
    const { walletId, reset, signedIn } = useWalletSession.getState()
    if (signedIn) {
      await signOutSession().catch(() => undefined)
    }
    reset()
    queryClient.removeQueries({ queryKey: authKeys.all })
    await (walletId ? getWalletAdapter(walletId)?.disconnect() : undefined)
  }
}
