import { useWalletSessionSync } from '@/entities/wallet'
import { connectApiToSession } from './auth-bridge'

connectApiToSession()

/** Невидимый компонент: держит сессию в синхроне с расширением кошелька. */
export const WalletSessionSync = (): null => {
  useWalletSessionSync()
  return null
}
