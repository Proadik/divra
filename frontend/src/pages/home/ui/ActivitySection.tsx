import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useMoney } from '@/entities/currency'
import type { Activity } from '@/shared/api'
import { groupPath } from '@/shared/config'
import { formatRelativeDay } from '@/shared/lib/format'
import { Amount, Avatar, ExplorerLink, ListGroup, ListRow, toneFor } from '@/shared/ui'
import { activityTitle } from '../lib/groups'

export const ActivitySection = ({ items }: { items: Activity[] }): ReactElement | null => {
  const navigate = useNavigate()
  const money = useMoney()
  if (items.length === 0) {
    return null
  }
  return (
    <ListGroup title="Недавнее">
      {items.map((item) => (
        <ListRow
          key={item.id}
          // Перевод с подписью — строка со ссылкой в обозреватель (ссылку нельзя вложить в кнопку)
          onClick={item.signature ? undefined : () => void navigate(groupPath(item.groupId))}
          leading={
            <Avatar
              initials={item.actor.initials}
              tone={toneFor(item.actor.name)}
              title={item.actor.name}
            />
          }
          title={activityTitle(item)}
          subtitle={
            item.type === 'cash' ? (
              `${item.groupName} · наличными · ${formatRelativeDay(item.createdAt)}`
            ) : item.type === 'payment' ? (
              <span className="home__onchain">
                Подтверждено в Solana · {formatRelativeDay(item.createdAt)}
                {item.signature && (
                  <>
                    {' · '}
                    <ExplorerLink signature={item.signature} label="Solscan" />
                  </>
                )}
              </span>
            ) : (
              `${item.groupName} · ${formatRelativeDay(item.createdAt)}`
            )
          }
          trailing={
            <Amount
              value={money.fromUsd(item.myDelta)}
              signed
              size="sm"
              currency={money.symbol}
              fractionDigits={money.fractionDigits}
            />
          }
        />
      ))}
    </ListGroup>
  )
}
