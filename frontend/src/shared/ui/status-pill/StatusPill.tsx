import type { ReactElement, ReactNode } from 'react'
import { cx } from '@/shared/lib/classnames'
import './status-pill.css'

export type TxStatus = 'live' | 'pending' | 'confirmed' | 'finalized' | 'failed'

const LABELS: Record<TxStatus, string> = {
  live: 'Live',
  pending: 'Ожидает подписи',
  confirmed: 'Подтверждено',
  finalized: 'Готово',
  failed: 'Не прошло',
}

export type StatusPillProps = {
  status?: TxStatus
  children?: ReactNode
}

export const StatusPill = ({ status = 'live', children }: StatusPillProps): ReactElement => {
  return (
    <span className={cx('sp-pill', `sp-pill--${status}`)}>
      <span className="sp-pill__dot" aria-hidden />
      {children ?? LABELS[status]}
    </span>
  )
}
