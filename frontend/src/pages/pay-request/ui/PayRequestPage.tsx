import { useQuery } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { useParams } from 'react-router'
import { usePreferences } from '@/entities/currency'
import {
  RATES_STALE_MS,
  apiErrorMessage,
  getPaymentRequest,
  getRates,
  paymentKeys,
  ratesKeys,
} from '@/shared/api'
import { FIAT_SYMBOLS } from '@/shared/config'
import { formatAmount, formatAmountShort } from '@/shared/lib/format'
import { Avatar, ExplorerLink, Icon, Logo, toneFor } from '@/shared/ui'
import { PayActions } from './PayActions'
import './PayRequestPage.css'

const PAID_POLL_MS = 5_000

/**
 * Запрос на оплату глазами друга. Открывается без входа: данные — с бэкенда по коду,
 * оплата — ссылкой Solana Pay прямо в кошельке. Divra деньги не держит.
 */
export const PayRequestPage = (): ReactElement => {
  const { code = '' } = useParams()
  const currency = usePreferences((state) => state.inputCurrency)
  const request = useQuery({
    queryKey: paymentKeys.request(code),
    queryFn: () => getPaymentRequest(code),
    retry: false,
    // Пока не оплачено — спрашиваем бэкенд: он ищет перевод в сети и ответит «paid».
    // На скрытой вкладке опрос встаёт сам (refetchIntervalInBackground: false).
    refetchInterval: (query) => (query.state.data?.status === 'open' ? PAID_POLL_MS : false),
  })
  const rates = useQuery({
    queryKey: ratesKeys.usd(),
    queryFn: getRates,
    staleTime: RATES_STALE_MS,
  })
  const rate = currency === 'USD' ? null : rates.data?.rates[currency]

  const body = ((): ReactElement => {
    if (request.isPending) {
      return (
        <p className="pay__muted pay__state" role="status">
          Открываем запрос…
        </p>
      )
    }
    if (request.isError) {
      return (
        <div className="pay__state">
          <h1 className="pay__title">Запрос не работает</h1>
          <p className="pay__muted">
            {apiErrorMessage(request.error, 'Ссылка недействительна')}. Попроси новую ссылку.
          </p>
        </div>
      )
    }
    const data = request.data
    return (
      <>
        <section className="pay__card">
          <Avatar initials={data.fromName.charAt(0)} tone={toneFor(data.fromName)} size="lg" />
          <span className="pay__muted pay__lead">{data.fromName} просит перевести</span>
          <span className="pay__big">
            {formatAmount(data.amount)}
            <span className="pay__cur">{data.token}</span>
          </span>
          <span className="pay__muted">
            {rate
              ? `≈ ${formatAmountShort(Math.round(data.amount * rate))} ${FIAT_SYMBOLS[currency]} · `
              : ''}
            {data.groupName}
          </span>
          {data.message && <p className="pay__message">{data.message}</p>}
        </section>

        {data.status === 'paid' ? (
          <div className="pay__paid" role="status">
            <span className="pay__paid-icon">
              <Icon name="check" />
            </span>
            <span className="pay__title">Оплачено</span>
            <span className="pay__muted">Перевод найден в сети Solana, долг в группе погашен.</span>
            {data.signature && <ExplorerLink signature={data.signature} />}
          </div>
        ) : (
          <PayActions data={data} />
        )}
      </>
    )
  })()

  return (
    <main className="pay page-enter">
      <header className="pay__header">
        <Logo height={24} />
      </header>
      {body}
    </main>
  )
}
