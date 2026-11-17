import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import type { GroupSummary } from '@/shared/api'
import { addExpensePath } from '@/shared/config'
import { cx } from '@/shared/lib/classnames'
import { Button, Icon } from '@/shared/ui'
import { GROUP_KIND_ICONS } from '../lib/groups'

type PickGroupDialogProps = {
  groups: GroupSummary[]
  onClose: () => void
}

/** «Добавить расход» с главной: сначала выбираем группу. Содержимое модалки. */
export const PickGroupList = ({ groups, onClose }: PickGroupDialogProps): ReactElement => {
  const navigate = useNavigate()
  return (
    <ul className="home__pick">
      {groups.map((group) => (
        <li key={group.id}>
          <button
            type="button"
            className="home__pick-item"
            onClick={() => {
              onClose()
              void navigate(addExpensePath(group.id))
            }}
          >
            <span className={cx('home__tile', `home__tile--${group.kind}`)}>
              <Icon name={GROUP_KIND_ICONS[group.kind]} />
            </span>
            {group.name}
          </button>
        </li>
      ))}
      <li>
        <Button variant="ghost" block onClick={onClose}>
          Отмена
        </Button>
      </li>
    </ul>
  )
}
