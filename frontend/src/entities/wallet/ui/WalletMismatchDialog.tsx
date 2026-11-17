import { type ReactElement, useState } from 'react'
import { shortenAddress } from '@/shared/lib/format'
import { getWalletAdapter, walletErrorMessage } from '@/shared/lib/wallets'
import { Button, Modal } from '@/shared/ui'
import { reconnectWallet } from '../model/reconnect-wallet'
import { selectWalletMismatch, useWalletSession } from '../model/wallet-session-store'
import './WalletMismatch.css'

export type WalletMismatchDialogProps = {
  open: boolean
  onClose: () => void
  /** Аккаунты снова совпали — можно продолжать действие */
  onResolved?: () => void
}

/** Просит выбрать в расширении аккаунт сессии. Открывается перед действиями с подписью. */
export const WalletMismatchDialog = ({
  open,
  onClose,
  onResolved,
}: WalletMismatchDialogProps): ReactElement => {
  const mismatch = useWalletSession(selectWalletMismatch)
  const account = useWalletSession((state) => state.account)
  const walletAccount = useWalletSession((state) => state.walletAccount)
  const walletId = useWalletSession((state) => state.walletId)
  const walletName = (walletId ? getWalletAdapter(walletId)?.name : undefined) ?? 'кошельке'
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = (): void => {
    setError(null)
    onClose()
  }

  const reconnect = async (): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      if (await reconnectWallet()) {
        close()
        onResolved?.()
        return
      }
      setError(`В ${walletName} всё ещё выбран другой аккаунт`)
    } catch (reason) {
      setError(walletErrorMessage(reason))
    } finally {
      setPending(false)
    }
  }

  const switchAccount = (): void => {
    // Сессия переходит на новый аккаунт — SessionGate отправит на подпись
    useWalletSession.getState().switchToWalletAccount()
    close()
  }

  const sessionAddress = account ? shortenAddress(account.address) : ''

  return (
    <Modal
      open={open}
      onClose={close}
      title={mismatch === 'wallet-disconnected' ? 'Кошелёк отключён' : 'Нужен другой аккаунт'}
      actions={
        <>
          <Button size="lg" block icon="wallet" disabled={pending} onClick={() => void reconnect()}>
            {pending ? 'Ждём кошелёк…' : 'Переподключить'}
          </Button>
          {mismatch === 'other-account' && walletAccount && (
            <Button variant="secondary" block disabled={pending} onClick={switchAccount}>
              Войти как {shortenAddress(walletAccount.address)}
            </Button>
          )}
          <Button variant="ghost" onClick={close}>
            Отмена
          </Button>
        </>
      }
    >
      {mismatch === 'wallet-disconnected' ? (
        <p className="wallet-mismatch__text">
          {walletName} не отдаёт аккаунт — доступ отозван или кошелёк заблокирован. Разблокируй его
          и нажми «Переподключить».
        </p>
      ) : (
        <p className="wallet-mismatch__text">
          Это действие подписывается аккаунтом <b>{sessionAddress}</b>, с которым ты вошёл. Сейчас в{' '}
          {walletName} выбран <b>{walletAccount ? shortenAddress(walletAccount.address) : '—'}</b>.
          Переключись на {sessionAddress} в расширении и нажми «Переподключить».
        </p>
      )}
      {error && (
        <p className="wallet-mismatch__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
