import { type ReactElement, useState } from 'react'
import { type DetectedTransfer, apiErrorMessage } from '@/shared/api'
import { formatAmount, formatRelativeDay } from '@/shared/lib/format'
import { Button, ExplorerLink, Icon } from '@/shared/ui'
import { type DetectedTransfersModel, useDetectedTransfers } from '../model/use-detected-transfers'
import './DetectedTransfers.css'

const MAX_VISIBLE = 3

const TransferCard = ({
  item,
  model,
  groupId,
}: {
  item: DetectedTransfer
  model: DetectedTransfersModel
  /** На странице группы засчитываем в неё */
  groupId?: string
}): ReactElement => {
  const [picked, setPicked] = useState(groupId ?? item.groups[0]?.groupId ?? '')
  const target = item.groups.find((group) => group.groupId === picked) ?? item.groups[0]
  const busy =
    (model.apply.isPending && model.apply.variables.id === item.id) ||
    (model.dismiss.isPending && model.dismiss.variables === item.id)
  const error =
    (model.apply.variables?.id === item.id ? model.apply.error : null) ??
    (model.dismiss.variables === item.id ? model.dismiss.error : null)

  return (
    <article className="detected__card" aria-label={`Перевод от ${item.fromName}`}>
      <header className="detected__head">
        <span className="detected__icon" aria-hidden>
          <Icon name="wallet" />
        </span>
        <span className="detected__titles">
          <span className="detected__title">
            {item.fromName} перевёл тебе {formatAmount(item.amount)} {item.token}
          </span>
          <span className="detected__sub">
            из кошелька, мимо Divra · {formatRelativeDay(item.createdAt)} ·{' '}
            <ExplorerLink signature={item.signature} label="Solscan" />
          </span>
        </span>
      </header>

      {target && (
        <p className="detected__text">
          {item.groups.length > 1 && !groupId ? (
            <label className="detected__pick">
              Засчитать в{' '}
              <select
                value={target.groupId}
                onChange={(event) => setPicked(event.currentTarget.value)}
                aria-label="Группа"
              >
                {item.groups.map((group) => (
                  <option key={group.groupId} value={group.groupId}>
                    {group.groupName}
                  </option>
                ))}
              </select>
              ?
            </label>
          ) : (
            <>Засчитать в «{target.groupName}»? </>
          )}{' '}
          {item.fromName} должен тебе {formatAmount(target.owed)} {item.token}.
        </p>
      )}

      <div className="detected__actions">
        <Button
          size="md"
          disabled={busy || !target}
          onClick={() => target && model.apply.mutate({ id: item.id, groupId: target.groupId })}
        >
          Засчитать
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => model.dismiss.mutate(item.id)}>
          Это не за долг
        </Button>
      </div>
      {error && (
        <p className="detected__error" role="alert">
          {apiErrorMessage(error, 'Не получилось — попробуй ещё раз')}
        </p>
      )}
    </article>
  )
}

/**
 * Переводы, которые участники сделали тебе мимо Divra (прямо из кошелька). Засчитывает
 * только получатель — деньги у него, и только он знает, за что перевод.
 * С groupId — только переводы, которые можно засчитать в эту группу.
 */
export const DetectedTransfers = ({ groupId }: { groupId?: string }): ReactElement | null => {
  const model = useDetectedTransfers()
  const [expanded, setExpanded] = useState(false)
  const items = groupId
    ? model.items.filter((item) => item.groups.some((group) => group.groupId === groupId))
    : model.items
  if (items.length === 0) {
    return null
  }
  const visible = expanded ? items : items.slice(0, MAX_VISIBLE)
  return (
    <section className="detected" aria-label="Переводы мимо Divra">
      {visible.map((item) => (
        <TransferCard key={item.id} item={item} model={model} groupId={groupId} />
      ))}
      {items.length > visible.length && (
        <Button variant="ghost" onClick={() => setExpanded(true)}>
          Ещё {items.length - visible.length}
        </Button>
      )}
    </section>
  )
}
