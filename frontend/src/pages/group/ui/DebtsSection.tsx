import type { ReactElement } from 'react'
import type { Money } from '@/entities/currency'
import type { GroupOverview } from '@/shared/api'
import { pluralize } from '@/shared/lib/format'
import { Amount, Avatar, ListGroup, ListRow } from '@/shared/ui'
import { findMember, toneOf } from '../lib/group'

export const DebtsSection = ({
  group,
  money,
}: {
  group: GroupOverview
  money: Money
}): ReactElement | null => {
  if (group.debts.length === 0) {
    return null
  }
  const transfers = pluralize(group.debts.length, {
    one: 'перевод',
    few: 'перевода',
    many: 'переводов',
  })

  return (
    <ListGroup
      title="Кто кому"
      aside={
        // «2 перевода вместо 2» ничего не сообщает — показываем, только когда зачёт сэкономил переводы
        group.transfersBeforeSimplify > group.debts.length
          ? `${transfers} вместо ${group.transfersBeforeSimplify}`
          : transfers
      }
    >
      {group.debts.map((debt) => {
        const iOwe = findMember(group, debt.fromId)?.isMe ?? false
        const other = findMember(group, iOwe ? debt.toId : debt.fromId)
        if (!other) {
          return null
        }
        return (
          <ListRow
            key={`${debt.fromId}-${debt.toId}`}
            leading={
              <Avatar initials={other.initials} tone={toneOf(group, other.id)} title={other.name} />
            }
            title={other.name}
            subtitle={`${iOwe ? 'ты вернёшь' : 'вернёт тебе'}${other.status === 'pending' ? ' · без кошелька' : ''}`}
            trailing={
              <Amount
                value={money.fromUsd(iOwe ? -debt.amount : debt.amount)}
                signed
                size="sm"
                currency={money.symbol}
                fractionDigits={money.fractionDigits}
              />
            }
          />
        )
      })}
    </ListGroup>
  )
}
