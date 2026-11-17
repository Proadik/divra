import { type ReactElement, useState } from 'react'
import { shortenAddress } from '@/shared/lib/format'
import { getWalletAdapter } from '@/shared/lib/wallets'
import { Button } from '@/shared/ui'
import { selectWalletMismatch, useWalletSession } from '../model/wallet-session-store'
import { WalletMismatchDialog } from './WalletMismatchDialog'
import './WalletMismatch.css'

/** Плашка о расхождении сессии и расширения. Из аккаунта не выкидывает. */
export const WalletMismatchBanner = (): ReactElement | null => {
  const mismatch = useWalletSession(selectWalletMismatch)
  const walletAccount = useWalletSession((state) => state.walletAccount)
  const walletId = useWalletSession((state) => state.walletId)
  const walletName = (walletId ? getWalletAdapter(walletId)?.name : undefined) ?? 'Кошелёк'
  const [open, setOpen] = useState(false)

  if (!mismatch) {
    return null
  }

  return (
    <div className="wallet-mismatch" role="status">
      <p className="wallet-mismatch__banner-text">
        {mismatch === 'wallet-disconnected'
          ? `${walletName} отключён. Подключи его, чтобы подписывать операции.`
          : `В ${walletName} выбран другой аккаунт (${walletAccount ? shortenAddress(walletAccount.address) : '—'}).`}
      </p>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Исправить
      </Button>
      <WalletMismatchDialog open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
