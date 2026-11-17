import { getWalletAdapter, toWalletError } from '@/shared/lib/wallets'
import { useWalletSession } from './wallet-session-store'

/**
 * Открывает окно расширения и запоминает выбранный там аккаунт.
 * Возвращает true, если теперь в расширении выбран аккаунт сессии.
 */
export const reconnectWallet = async (): Promise<boolean> => {
  const { walletId } = useWalletSession.getState()
  const adapter = walletId ? getWalletAdapter(walletId) : undefined
  if (!adapter) {
    throw toWalletError(new Error('Кошелёк не найден'))
  }
  const account = await adapter.connect()
  useWalletSession.getState().accountChanged(account)
  const { account: session } = useWalletSession.getState()
  return session?.address === account.address && session.chain === account.chain
}
