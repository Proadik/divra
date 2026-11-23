import { type ReactElement, useState } from 'react'
import type { Money } from '@/entities/currency'
import type { GroupMember, GroupOverview } from '@/shared/api'
import { pluralize } from '@/shared/lib/format'
import { Amount, Avatar, ListGroup, ListRow } from '@/shared/ui'
import { findMember, toneOf } from '../lib/group'
import { CashDialog } from './CashDialog'

export const DebtsSection = ({
  group,
  money,
}: {
  group: GroupOverview
  money: Money
}): ReactElement | null => {
  const [cash, setCash] = useState<{ member: GroupMember; owed: number } | null>(null)
  if (group.debts.length === 0) {
    return null
  }
  const owedToMe = group.debts.some((debt) => findMember(group, debt.toId)?.isMe)
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
            // Тебе должны — можно отметить возврат наличными
            onClick={iOwe ? undefined : () => setCash({ member: other, owed: debt.amount })}
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
      {owedToMe && <p className="group-page__hint">Вернули наличными? Нажми на строку должника.</p>}
      <CashDialog
        groupId={group.id}
        debtor={cash?.member ?? null}
        owed={cash?.owed ?? 0}
        onClose={() => setCash(null)}
      />
    </ListGroup>
  )
}
