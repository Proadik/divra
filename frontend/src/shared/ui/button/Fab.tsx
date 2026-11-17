import type { ComponentProps, ReactElement } from 'react'
import { cx } from '@/shared/lib/classnames'
import { Icon, type IconName } from '../icon'
import './button.css'

export type FabProps = ComponentProps<'button'> & {
  icon?: IconName
}

/** Плавающая кнопка «Добавить расход». Одна на экран, единственный элемент с тенью. */
export const Fab = ({
  icon = 'plus',
  className,
  children,
  type = 'button',
  ...rest
}: FabProps): ReactElement => {
  return (
    <button type={type} className={cx('sp-fab', className)} {...rest}>
      <Icon name={icon} strokeWidth={2.2} />
      {children}
    </button>
  )
}
