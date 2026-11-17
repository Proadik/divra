import { useEffect } from 'react'
import { refreshAccessToken } from '@/shared/api'
import { getWalletAdapter } from '@/shared/lib/wallets'
import { useWalletSession } from './wallet-session-store'

/** Сколько ждём, пока расширение зарегистрируется после загрузки страницы */
const RESTORE_TIMEOUT_MS = 3000

/**
 * Связывает стор с расширением:
 * 1) слушает смену аккаунта в активном кошельке;
 * 2) после перезагрузки тихо переподключается к сохранённому кошельку.
 * Ни то ни другое не выкидывает из подтверждённой сессии — только помечает расхождение.
 * Монтируется один раз в app.
 */
export const useWalletSessionSync = (): void => {
  const walletId = useWalletSession((state) => state.walletId)
  const status = useWalletSession((state) => state.status)

  useEffect(() => {
    const adapter = walletId ? getWalletAdapter(walletId) : undefined
    if (!adapter) {
      return undefined
    }
    return adapter.onAccountChange((account) => {
      const { accountChanged } = useWalletSession.getState()
      if (account) {
        accountChanged(account)
        return
      }
      // «Аккаунтов нет» часто приходит на мгновение — например, когда кошелёк переподключает
      // сайт из другого окна. Переспрашиваем тихо и только потом считаем кошелёк отключённым.
      adapter
        .connect({ silent: true })
        .then((restored) => accountChanged(restored))
        .catch(() => accountChanged(null))
    })
  }, [walletId])

  useEffect(() => {
    if (status !== 'restoring' || !walletId) {
      return undefined
    }
    const { restored, restoreFailed, signedIn } = useWalletSession.getState()
    // Вход был — новый access-токен по HttpOnly-cookie. Не вышло — сессия истекла.
    const resume = async (): Promise<string | null> => {
      if (!signedIn) {
        return null
      }
      try {
        return (await refreshAccessToken()).accessToken
      } catch {
        return null
      }
    }
    const adapter = getWalletAdapter(walletId)
    if (!adapter) {
      void resume().then(restoreFailed)
      return undefined
    }

    let cancelled = false
    const restore = async (): Promise<void> => {
      const account = await adapter.connect({ silent: true }).catch(() => null)
      const token = await resume()
      if (cancelled) {
        return
      }
      if (account) {
        restored(account, token)
      } else {
        restoreFailed(token)
      }
    }

    if (adapter.isInstalled()) {
      void restore()
      return () => {
        cancelled = true
      }
    }

    const timer = setTimeout(() => {
      void resume().then((token) => !cancelled && restoreFailed(token))
    }, RESTORE_TIMEOUT_MS)
    const off = adapter.onAvailabilityChange(() => {
      if (adapter.isInstalled()) {
        off()
        clearTimeout(timer)
        void restore()
      }
    })
    return () => {
      cancelled = true
      off()
      clearTimeout(timer)
    }
  }, [status, walletId])
}
