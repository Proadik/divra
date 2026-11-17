import type { ReactElement } from 'react'
import { explorerTxUrl } from '@/shared/config'
import { cx } from '@/shared/lib/classnames'
import { Icon } from '../icon'
import './explorer-link.css'

const shortSignature = (signature: string): string =>
  `${signature.slice(0, 4)}…${signature.slice(-4)}`

/** Ссылка на транзакцию в Solscan (с учётом сети): «Транзакция 5p8v…g6Kq ↗» */
export const ExplorerLink = ({
  signature,
  label = 'Транзакция',
  className,
}: {
  signature: string
  label?: string
  className?: string
}): ReactElement => (
  <a
    className={cx('sp-explorer', className)}
    href={explorerTxUrl(signature)}
    target="_blank"
    rel="noreferrer"
    title={signature}
  >
    {label} {shortSignature(signature)}
    <Icon name="arrow-up-right" size={14} />
  </a>
)
