import { type ReactElement, useRef, useState } from 'react'
import { selectWalletMismatch, useWalletSession } from '../model/wallet-session-store'
import { WalletMismatchDialog } from './WalletMismatchDialog'

export type WalletGuard = {
  /** Выполнить действие с подписью: сразу, если аккаунты совпадают, иначе — после переподключения */
  requireWallet: (action: () => void) => void
  /** Модалку нужно отрисовать рядом с кнопкой */
  dialog: ReactElement
}

/**
 * Для действий, которые подписывает кошелёк. Если в расширении выбран не тот аккаунт
 * или кошелёк отключён — показывает модалку, а действие запускает после исправления.
 */
export const useWalletGuard = (): WalletGuard => {
  const mismatch = useWalletSession(selectWalletMismatch)
  const [open, setOpen] = useState(false)
  const pending = useRef<(() => void) | null>(null)

  return {
    requireWallet: (action) => {
      if (!mismatch) {
        action()
        return
      }
      pending.current = action
      setOpen(true)
    },
    dialog: (
      <WalletMismatchDialog
        open={open}
        onClose={() => {
          setOpen(false)
          pending.current = null
        }}
        onResolved={() => {
          const action = pending.current
          pending.current = null
          action?.()
        }}
      />
    ),
  }
}
