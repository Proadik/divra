import { type ReactElement, type ReactNode, useId } from 'react'
import { formatAmount, formatRelativeDay } from '@/shared/lib/format'
import { Avatar, Button, Checkbox, toneFor } from '@/shared/ui'
import type { RequestModel } from '../model/use-request'

export const RequestPick = ({
  model,
  children,
}: {
  model: RequestModel
  /** Над кнопкой: список отправленных запросов */
  children?: ReactNode
}): ReactElement => {
  const messageId = useId()
  const { rows, token } = model

  return (
    <>
      <section className="request__summary">
        <span className="request__summary-label">Тебе должны</span>
        <span className="request__summary-value">
          {formatAmount(rows.reduce((sum, row) => sum + row.amount, 0))}
          <span className="request__cur">{token}</span>
        </span>
        <span className="request__summary-hint">Кому отправить ссылку на оплату</span>
      </section>

      <section className="request__section" aria-labelledby="request-who">
        <h2 id="request-who" className="request__heading">
          У кого запросить
        </h2>
        <div className="sp-listgroup">
          {rows.map((row) => (
            <label key={row.member.id} className="sp-row request__row">
              <Checkbox
                checked={row.selected}
                onChange={(event) => model.toggle(row.member.id, event.currentTarget.checked)}
              />
              <Avatar initials={row.member.initials} tone={toneFor(row.member.name)} />
              <span className="sp-row__body">
                <span className="sp-row__title">{row.member.name}</span>
                <span className={row.requestedAt ? 'sp-row__sub request__asked' : 'sp-row__sub'}>
                  {row.requestedAt
                    ? `запрос ${formatRelativeDay(row.requestedAt)} · ещё не оплачен`
                    : 'ещё не запрашивали'}
                </span>
              </span>
              <span className="request__amount">
                +{formatAmount(row.amount)} <span>{token}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="request__section">
        <label htmlFor={messageId} className="request__heading">
          Сообщение
        </label>
        <textarea
          id={messageId}
          className="request__message"
          rows={2}
          maxLength={140}
          value={model.message}
          onChange={(event) => model.setMessage(event.currentTarget.value)}
        />
        <label className="request__toggle">
          <span className="request__toggle-text">
            <span>Напомнить через {model.remindInDays} дня</span>
            <span className="request__muted">если не оплатят</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="request__switch"
            checked={model.remind}
            onChange={(event) => model.setRemind(event.currentTarget.checked)}
          />
        </label>
      </section>

      {children}

      <div className="request__footer page-enter-action">
        {model.error && (
          <p className="request__error" role="alert">
            {model.error.message}
          </p>
        )}
        <Button
          size="lg"
          block
          disabled={model.selectedCount === 0 || model.isSubmitting}
          onClick={model.submit}
        >
          {model.isSubmitting
            ? 'Создаём ссылки…'
            : model.selectedCount > 0
              ? `Создать запрос · ${formatAmount(model.total)} ${token}`
              : 'Выбери, у кого запросить'}
        </Button>
      </div>
    </>
  )
}
