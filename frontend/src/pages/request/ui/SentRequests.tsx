import type { ReactElement } from 'react'
import type { SentPaymentRequest } from '@/shared/api'
import { formatAmount, formatRelativeDay } from '@/shared/lib/format'
import { Avatar, ExplorerLink, ListGroup, ListRow, toneFor } from '@/shared/ui'

const statusText = (item: SentPaymentRequest): string => {
  const sent = `отправлен ${formatRelativeDay(item.createdAt)}`
  switch (item.status) {
    case 'open':
      return item.remindedAt
        ? `${sent} · напоминал ${formatRelativeDay(item.remindedAt)}`
        : `${sent} · ждёт оплаты до ${formatRelativeDay(item.expiresAt)}`
    case 'paid':
      return `оплачен${item.signature ? '' : ' наличными'} ${formatRelativeDay(item.paidAt ?? item.createdAt)}`
    case 'expired':
      return `${sent} · ссылка истекла`
  }
}

/**
 * Мои запросы в группе. Ждущий оплаты открывается заново — та же ссылка и QR, чтобы
 * напомнить другу без нового запроса. Оплаченные и истёкшие — для истории.
 */
export const SentRequests = ({
  items,
  onOpen,
}: {
  items: readonly SentPaymentRequest[]
  onOpen: (item: SentPaymentRequest) => void
}): ReactElement | null => {
  if (items.length === 0) {
    return null
  }
  return (
    <ListGroup title="Отправленные" aside={`${items.length}`}>
      {items.map((item) => (
        <ListRow
          key={item.code}
          className={`request__sent request__sent--${item.status}`}
          leading={<Avatar initials={item.memberName.charAt(0)} tone={toneFor(item.memberName)} />}
          title={item.memberName}
          subtitle={statusText(item)}
          trailing={
            <span className="request__sent-trail">
              <span className="request__sent-amount">
                {formatAmount(item.amount)} <span>{item.token}</span>
              </span>
              {/* Строка оплаченного запроса не кнопка — ссылку можно вложить */}
              {item.status === 'paid' && item.signature && (
                <ExplorerLink signature={item.signature} label="Solscan" />
              )}
            </span>
          }
          onClick={item.status === 'open' ? () => onOpen(item) : undefined}
        />
      ))}
    </ListGroup>
  )
}
