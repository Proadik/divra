import type { ReactElement } from 'react'
import { CATEGORY_ICONS } from '@/entities/expense'
import type { Money } from '@/entities/currency'
import type { GroupExpense, GroupOverview } from '@/shared/api'
import { fiatSymbol } from '@/shared/config'
import { formatAmountShort, formatRelativeDay } from '@/shared/lib/format'
import { Amount, ListGroup, ListRow, StatusPill } from '@/shared/ui'
import { findMember } from '../lib/group'

const ShareNote = ({
  expense,
  paidByMe,
  money,
}: {
  expense: GroupExpense
  paidByMe: boolean
  money: Money
}): ReactElement => {
  if (paidByMe) {
    return (
      <span className="group-page__share group-page__share--back">
        вернут {money.format(money.ofExpense(expense, expense.amount - expense.myShare))}{' '}
        {money.symbol}
      </span>
    )
  }
  if (expense.myShare > 0) {
    return (
      <span className="group-page__share group-page__share--owe">
        доля {money.format(money.ofExpense(expense, expense.myShare))} {money.symbol}
      </span>
    )
  }
  return <span className="group-page__share">без тебя</span>
}

export const ExpensesSection = ({
  group,
  money,
}: {
  group: GroupOverview
  money: Money
}): ReactElement => {
  return (
    <ListGroup title="Расходы" aside={<StatusPill status="live" />}>
      {group.expenses.length === 0 && (
        <p className="group-page__empty">
          {group.members.length > 1
            ? 'Пока пусто. Добавь первый расход — разделим его между участниками.'
            : 'Пока пусто. Позови друзей в группу и добавь первый расход.'}
        </p>
      )}
      {group.expenses.map((expense) => {
        const payer = findMember(group, expense.paidById)
        const paidByMe = payer?.isMe ?? false
        return (
          <ListRow
            key={expense.id}
            icon={CATEGORY_ICONS[expense.category]}
            title={expense.title}
            subtitle={[
              payer?.name ?? 'Участник',
              formatRelativeDay(expense.createdAt),
              expense.original &&
                !(money.isFiat && money.unit === expense.original.currency) &&
                `${formatAmountShort(expense.original.amount)} ${fiatSymbol(expense.original.currency)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
            trailing={
              <>
                <Amount
                  value={money.ofExpense(expense, expense.amount)}
                  size="sm"
                  currency={money.symbol}
                  fractionDigits={money.fractionDigits}
                />
                <ShareNote expense={expense} paidByMe={paidByMe} money={money} />
              </>
            }
          />
        )
      })}
    </ListGroup>
  )
}
