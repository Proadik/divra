import type { ReactElement } from 'react'
import { type PaymentRequestPreview, apiErrorMessage, canPayFromPage } from '@/shared/api'
import { formatAmount } from '@/shared/lib/format'
import {
  WalletError,
  useWalletAdapters,
  walletAdapters,
  walletErrorMessage,
} from '@/shared/lib/wallets'
import { Button, Icon, QrCode } from '@/shared/ui'
import { type PayPhase, useWalletPay } from '../model/use-wallet-pay'

const PHASE_TEXT: Record<PayPhase, string> = {
  connecting: 'Подключаем кошелёк…',
  preparing: 'Готовим перевод…',
  signing: 'Подтверди перевод в кошельке',
  sending: 'Отправляем в сеть…',
}

const errorText = (error: unknown): string =>
  error instanceof WalletError
    ? walletErrorMessage(error)
    : apiErrorMessage(error, 'Не получилось отправить перевод')

export const PayActions = ({ data }: { data: PaymentRequestPreview }): ReactElement => {
  const installed = useWalletAdapters(walletAdapters).filter((adapter) => adapter.isInstalled())
  const wallet = useWalletPay(data.code)
  const amountText = `${formatAmount(data.amount)} ${data.token}`
  const busy = wallet.phase !== null
  // Расширение есть — платим прямо отсюда; нет — ссылка solana: (её откроет кошелёк на телефоне)
  const payHere = canPayFromPage && installed.length > 0

  return (
    <div className="pay__actions">
      {payHere &&
        installed.map((adapter, index) => (
          <Button
            key={adapter.id}
            variant={index === 0 ? 'primary' : 'secondary'}
            size="lg"
            block
            icon="wallet"
            disabled={busy || wallet.sent}
            onClick={() => wallet.pay(adapter)}
          >
            Оплатить в {adapter.name} · {amountText}
          </Button>
        ))}
      {!payHere && (
        <a className="sp-btn sp-btn--primary sp-btn--lg sp-btn--block" href={data.solanaPayUrl}>
          <Icon name="wallet" />
          Открыть в кошельке · {amountText}
        </a>
      )}

      <p className="pay__muted pay__center" role="status" aria-live="polite">
        {wallet.phase && PHASE_TEXT[wallet.phase]}
        {!wallet.phase && wallet.sent && 'Перевод отправлен — ждём подтверждения сети…'}
        {!wallet.phase && !wallet.sent && wallet.error !== null && (
          <span className="pay__error">{errorText(wallet.error)}</span>
        )}
      </p>

      <details className="pay__phone">
        <summary>Кошелёк на телефоне? Показать QR</summary>
        <span className="pay__qr">
          <QrCode
            value={data.solanaPayUrl}
            label={`QR Solana Pay: перевести ${amountText} ${data.fromName}`}
          />
        </span>
      </details>
      <p className="pay__muted pay__center">
        Деньги уходят напрямую на кошелёк получателя в Solana. Divra их не хранит. После перевода
        эта страница сама покажет «Оплачено».
      </p>
    </div>
  )
}
