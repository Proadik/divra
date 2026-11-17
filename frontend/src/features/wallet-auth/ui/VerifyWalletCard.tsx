import type { ReactElement } from 'react'
import { useWalletGuard } from '@/entities/wallet'
import { ApiError } from '@/shared/api'
import { shortenAddress } from '@/shared/lib/format'
import { WalletError, walletErrorMessage } from '@/shared/lib/wallets'
import { Button, type TxStep, TxSteps } from '@/shared/ui'
import { type VerifyPhase, useVerifyWallet } from '../model/use-verify-wallet'
import './VerifyWalletCard.css'

const stepsFor = (phase: VerifyPhase): TxStep[] => {
  const order: VerifyPhase[] = ['loading', 'ready', 'verifying', 'done']
  const at = order.indexOf(phase === 'signing' ? 'ready' : phase)
  const state = (index: number): TxStep['state'] =>
    at > index ? 'done' : at === index ? 'active' : 'todo'
  return [
    { label: 'Сервер готовит транзакцию', state: state(0) },
    {
      label: 'Подпись в кошельке',
      state: state(1),
      hint: phase === 'signing' ? 'Открой окно кошелька и нажми «Подтвердить»' : undefined,
    },
    { label: 'Проверка подписи', state: state(2) },
  ]
}

const errorText = (error: Error): string => {
  if (error instanceof WalletError) {
    return walletErrorMessage(error)
  }
  if (error instanceof ApiError) {
    const message = (error.data as { message?: unknown } | null)?.message
    return typeof message === 'string' ? message : 'Сервер не принял подпись'
  }
  return 'Не удалось подготовить подтверждение. Попробуй ещё раз.'
}

export const VerifyWalletCard = (): ReactElement => {
  const { account, challenge, confirm, error, phase, isBusy } = useVerifyWallet()
  const { requireWallet, dialog } = useWalletGuard()

  return (
    <section className="verify-card" aria-labelledby="verify-title">
      <div className="verify-card__head">
        <h2 id="verify-title" className="verify-card__title">
          Подпиши транзакцию
        </h2>
        {account && <span className="verify-card__address">{shortenAddress(account.address)}</span>}
      </div>

      <div className="verify-card__message">
        <div className="verify-card__label">Что ты подписываешь</div>
        <p className="verify-card__memo">
          {challenge.data?.message ?? 'Получаем транзакцию от сервера…'}
        </p>
        <p className="verify-card__caption">
          Это не перевод: транзакция не отправляется в сеть и ничего не списывает. Подпись только
          доказывает, что кошелёк твой.
        </p>
      </div>

      <TxSteps steps={stepsFor(phase)} />

      {error && (
        <p className="verify-card__error" role="alert">
          {errorText(error)}
        </p>
      )}

      <Button
        size="lg"
        block
        disabled={isBusy || !challenge.data}
        onClick={() => requireWallet(confirm)}
      >
        {phase === 'signing'
          ? 'Ждём подпись…'
          : phase === 'verifying'
            ? 'Проверяем…'
            : 'Подписать в кошельке'}
      </Button>
      {dialog}
    </section>
  )
}
