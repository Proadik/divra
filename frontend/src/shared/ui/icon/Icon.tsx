import type { ReactElement } from 'react'
import { cx } from '@/shared/lib/classnames'
import { ICONS, type IconName } from './icons'
import './icon.css'

export type IconProps = {
  name: IconName
  size?: number
  strokeWidth?: number
  /** Подпись для смысловой иконки без текста рядом. Без неё иконка декоративная. */
  label?: string
  className?: string
}

export const Icon = ({
  name,
  size = 20,
  strokeWidth = 1.8,
  label,
  className,
}: IconProps): ReactElement => {
  return (
    <svg
      className={cx('sp-icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
