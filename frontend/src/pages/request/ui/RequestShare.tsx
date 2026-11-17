import { type ReactElement, useState } from 'react'
import type { PaymentRequest } from '@/shared/api'
import { cx } from '@/shared/lib/classnames'
import { formatAmount } from '@/shared/lib/format'
import { Icon, type IconName, QrCode } from '@/shared/ui'

const shareText = (request: PaymentRequest, message: string): string =>
  `${message}\n${formatAmount(request.amount)} ${request.token}: ${request.url}`

const ShareButton = ({
  icon,
  label,
  href,
  onClick,
}: {
  icon: IconName
  label: string
  href?: string
  onClick?: () => void
}): ReactElement => {
  const content = (
    <>
      <span className="request__share-icon">
        <Icon name={icon} size={22} />
      </span>
      {label}
    </>
  )
  return href ? (
    <a className="request__share" href={href} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <button type="button" className="request__share" onClick={onClick}>
      {content}
    </button>
  )
}

export const RequestShare = ({
  requests,
  message,
}: {
  requests: PaymentRequest[]
  message: string
}): ReactElement => {
  const [activeId, setActiveId] = useState(requests[0]?.memberId)
  const [copied, setCopied] = useState(false)
  const active = requests.find((item) => item.memberId === activeId) ?? requests[0]
  if (!active) {
    return <p className="request__muted">Запросов нет</p>
  }
  const text = shareText(active, message)
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(active.url).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  const canShare = typeof navigator.share === 'function'

  return (
    <>
      {requests.length > 1 && (
        <div className="request__chips" role="tablist" aria-label="Кому">
          {requests.map((item) => (
            <button
              key={item.memberId}
              type="button"
              role="tab"
              aria-selected={item.memberId === active.memberId}
              className={cx('request__chip', item.memberId === active.memberId && 'is-on')}
              onClick={() => setActiveId(item.memberId)}
            >
              {item.memberName} · {formatAmount(item.amount)}
            </button>
          ))}
        </div>
      )}

      <section className="request__card">
        <span className="request__qr">
          <QrCode
            value={active.solanaPayUrl}
            label={`QR Solana Pay: ${active.memberName} платит ${formatAmount(active.amount)} ${active.token}`}
          />
        </span>
        <span className="request__card-title">
          {active.memberName} платит {formatAmount(active.amount)} {active.token}
        </span>
        <span className="request__muted">Отсканирует камерой кошелька или откроет ссылку</span>
        <span className="request__url">
          <span className="request__url-text">{active.url.replace(/^https?:\/\//, '')}</span>
          <button type="button" className="request__copy" onClick={() => void copy()}>
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </span>
      </section>

      <section className="request__shares">
        <ShareButton
          icon="send"
          label="Telegram"
          href={`https://t.me/share/url?url=${encodeURIComponent(active.url)}&text=${encodeURIComponent(message)}`}
        />
        <ShareButton
          icon="chat"
          label="WhatsApp"
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
        />
        <ShareButton icon="link" label="Ссылка" onClick={() => void copy()} />
        {canShare && (
          <ShareButton
            icon="more"
            label="Ещё"
            onClick={() => void navigator.share({ text, url: active.url }).catch(() => undefined)}
          />
        )}
      </section>

      <p className="request__muted request__center">
        Ссылка открывается и без аккаунта Divra. Когда {active.memberName} оплатит, долг в группе
        закроется.
      </p>
    </>
  )
}
