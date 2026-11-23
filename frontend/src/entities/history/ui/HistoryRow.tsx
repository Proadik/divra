import type { ReactElement } from 'react'
import type { HistoryItem } from '@/shared/api'
import { formatRelativeDay, shortenAddress } from '@/shared/lib/format'
import { Amount, ExplorerLink, Icon } from '@/shared/ui'
import './history-row.css'

const counterpartyOf = (item: HistoryItem): string =>
  item.counterparty.name ??
  (item.counterparty.address ? shortenAddress(item.counterparty.address) : 'неизвестный кошелёк')

const statusOf = (item: HistoryItem): string => {
  if (item.countedIn) {
    return `засчитано в «${item.countedIn}»`
  }
  return item.suggested ? 'ждёт решения: засчитать?' : 'не связано с долгами'
}

/**
 * Строка «Истории»: перевод стейблкоина в сети. Не кнопка — внутри ссылка в Solscan,
 * а ссылку нельзя вкладывать в кнопку.
 */
export const HistoryRow = ({ item }: { item: HistoryItem }): ReactElement => {
  const incoming = item.direction === 'in'
  return (
    <div className="sp-row history-row">
      <span className={`sp-row__tile history-row__tile history-row__tile--${item.direction}`}>
        <Icon name={incoming ? 'arrow-down-left' : 'arrow-up-right'} />
      </span>
      <span className="sp-row__body">
        <span className="sp-row__title">
          {incoming ? 'От' : 'Кому'}: {counterpartyOf(item)}
        </span>
        <span className="sp-row__sub">
          {statusOf(item)} · {formatRelativeDay(item.createdAt)} ·{' '}
          <ExplorerLink signature={item.signature} label="Solscan" />
        </span>
      </span>
      <span className="sp-row__trail">
        <Amount
          value={incoming ? item.amount : -item.amount}
          signed
          size="sm"
          currency={item.token}
        />
      </span>
    </div>
  )
}
