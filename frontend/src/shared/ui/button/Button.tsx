import type { ComponentProps, ReactElement } from 'react'
import { cx } from '@/shared/lib/classnames'
import { Icon, type IconName } from '../icon'
import './button.css'

export type ButtonProps = ComponentProps<'button'> & {
  /** primary — один раз на экран; secondary — на светлом фоне; inverse — на surface-inverse; ghost — текстовое действие */
  variant?: 'primary' | 'secondary' | 'inverse' | 'ghost'
  /** md — 48px внутри карточек, lg — 56px для нижнего CTA */
  size?: 'md' | 'lg'
  block?: boolean
  icon?: IconName
}

export const Button = ({
  variant = 'primary',
  size = 'md',
  block = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement => {
  return (
    <button
      type={type}
      className={cx(
        'sp-btn',
        `sp-btn--${variant}`,
        `sp-btn--${size}`,
        block && 'sp-btn--block',
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}
