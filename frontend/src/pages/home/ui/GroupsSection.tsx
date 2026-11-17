import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useMoney } from '@/entities/currency'
import type { GroupSummary } from '@/shared/api'
import { groupPath } from '@/shared/config'
import { cx } from '@/shared/lib/classnames'
import { formatRelativeDay, pluralize } from '@/shared/lib/format'
import { Amount, Button, Icon, ListGroup, ListRow } from '@/shared/ui'
import { GROUP_KIND_ICONS, balanceNote } from '../lib/groups'

type GroupsSectionProps = {
  groups: GroupSummary[]
  onCreate: () => void
}

export const GroupsSection = ({ groups, onCreate }: GroupsSectionProps): ReactElement => {
  const navigate = useNavigate()
  const money = useMoney()

  return (
    <ListGroup
      title="Группы"
      aside={
        <Button variant="ghost" icon="plus" className="home__new" onClick={onCreate}>
          Новая
        </Button>
      }
    >
      {groups.length === 0 && (
        <p className="home__empty">
          Пока ни одной группы. Создай первую и позови друзей по ссылке.
        </p>
      )}
      {groups.map((group) => (
        <ListRow
          key={group.id}
          onClick={() => void navigate(groupPath(group.id))}
          leading={
            <span className={cx('home__tile', `home__tile--${group.kind}`)}>
              <Icon name={GROUP_KIND_ICONS[group.kind]} />
            </span>
          }
          title={group.name}
          subtitle={`${pluralize(group.membersCount, {
            one: 'участник',
            few: 'участника',
            many: 'участников',
          })} · ${formatRelativeDay(group.lastActivityAt)}`}
          trailing={
            <>
              <Amount
                value={money.fromUsd(group.myBalance)}
                signed
                size="sm"
                currency={money.symbol}
                fractionDigits={money.fractionDigits}
              />
              <span className={cx('home__note', group.myBalance === 0 && 'home__note--settled')}>
                {balanceNote(group.myBalance)}
              </span>
            </>
          }
        />
      ))}
    </ListGroup>
  )
}
