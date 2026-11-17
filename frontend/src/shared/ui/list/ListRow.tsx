import type { ReactElement, ReactNode } from 'react'
import { cx } from '@/shared/lib/classnames'
import { Icon, type IconName } from '../icon'
import './list.css'

export type ListRowProps = {
  title: ReactNode
  subtitle?: ReactNode
  /** Иконка в плитке 40×40 (категория расхода) */
  icon?: IconName
  /** Свой элемент слева, обычно <Avatar /> */
  leading?: ReactNode
  trailing?: ReactNode
  /** С onClick строка становится кнопкой */
  onClick?: () => void
  className?: string
}

export const ListRow = ({
  title,
  subtitle,
  icon,
  leading,
  trailing,
  onClick,
  className,
}: ListRowProps): ReactElement => {
  const content = (
    <>
      {icon ? (
        <span className="sp-row__tile">
          <Icon name={icon} />
        </span>
      ) : (
        leading
      )}
      <span className="sp-row__body">
        <span className="sp-row__title">{title}</span>
        {subtitle && <span className="sp-row__sub">{subtitle}</span>}
      </span>
      {trailing && <span className="sp-row__trail">{trailing}</span>}
    </>
  )

  if (onClick) {
    return (
      <button type="button" className={cx('sp-row', 'sp-row--action', className)} onClick={onClick}>
        {content}
      </button>
    )
  }

  return <div className={cx('sp-row', className)}>{content}</div>
}
