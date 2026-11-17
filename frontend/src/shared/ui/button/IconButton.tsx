import type { ComponentProps, ReactElement } from 'react'
import { cx } from '@/shared/lib/classnames'
import { Icon, type IconName } from '../icon'
import './button.css'

export type IconButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  icon: IconName
  /** Обязателен: становится aria-label */
  label: string
  tone?: 'raised' | 'sunken'
}

export const IconButton = ({
  icon,
  label,
  tone = 'raised',
  className,
  type = 'button',
  ...rest
}: IconButtonProps): ReactElement => {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx('sp-iconbtn', tone === 'sunken' && 'sp-iconbtn--sunken', className)}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  )
}
