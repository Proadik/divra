import type { ReactElement } from 'react'
import { cx } from '@/shared/lib/classnames'
import { Avatar } from './Avatar'
import type { AvatarTone } from './tone'
import './avatar.css'

export type Person = {
  initials: string
  tone?: AvatarTone
  name?: string
}

export type AvatarStackProps = {
  people: Person[]
  size?: 'sm' | 'md'
  onInverse?: boolean
}

export const AvatarStack = ({
  people,
  size = 'sm',
  onInverse = false,
}: AvatarStackProps): ReactElement => {
  return (
    <span className={cx('sp-avstack', onInverse && 'sp-avstack--inverse')}>
      {people.map((person) => (
        <Avatar
          key={person.name ?? person.initials}
          initials={person.initials}
          tone={person.tone}
          title={person.name}
          size={size}
          ring
        />
      ))}
    </span>
  )
}
