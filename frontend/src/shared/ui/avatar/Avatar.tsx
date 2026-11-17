import type { ReactElement } from 'react'
import { cx } from '@/shared/lib/classnames'
import type { AvatarTone } from './tone'
import './avatar.css'

export type AvatarProps = {
  initials: string
  tone?: AvatarTone
  size?: 'sm' | 'md' | 'lg'
  /** Полное имя — для подсказки и скринридеров */
  title?: string
  ring?: boolean
  className?: string
}

export const Avatar = ({
  initials,
  tone = 1,
  size = 'md',
  title,
  ring = false,
  className,
}: AvatarProps): ReactElement => {
  return (
    <span
      className={cx(
        'sp-avatar',
        `sp-avatar--${size}`,
        `sp-avatar--t${tone}`,
        ring && 'sp-avatar--ring',
        className,
      )}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      {initials}
    </span>
  )
}
