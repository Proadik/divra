import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactElement, useState } from 'react'
import {
  type SentPaymentRequest,
  apiErrorMessage,
  cancelPaymentRequest,
  paymentKeys,
  remindPaymentRequest,
} from '@/shared/api'
import { formatRelativeDay } from '@/shared/lib/format'
import { Button, Modal } from '@/shared/ui'

const DAY_MS = 24 * 3_600_000

/**
 * Действия с отправленным запросом: напомнить (текст со ссылкой — в мессенджер или буфер)
 * и отменить. Бэкенд не даёт напоминать чаще раза в сутки.
 */
export const SentRequestActions = ({
  groupId,
  request,
  onCancelled,
}: {
  groupId: string
  request: SentPaymentRequest
  onCancelled: () => void
}): ReactElement => {
  const queryClient = useQueryClient()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // Момент открытия: сравнивать с ним, а не с Date.now() при каждой отрисовке
  const [openedAt] = useState(() => Date.now())
  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: paymentKeys.sent(groupId) })

  const remind = useMutation({
    mutationFn: () => remindPaymentRequest(groupId, request.code),
    onSuccess: async (reminder) => {
      await refresh()
      if (typeof navigator.share === 'function') {
        await navigator.share({ text: reminder.text }).catch(() => undefined)
        setNote('Следующее напоминание — завтра')
        return
      }
      await navigator.clipboard.writeText(reminder.text).catch(() => undefined)
      setNote('Текст напоминания скопирован — отправь его в мессенджер')
    },
  })
  const cancel = useMutation({
    mutationFn: () => cancelPaymentRequest(groupId, request.code),
    onSuccess: async () => {
      await refresh()
      setConfirmCancel(false)
      onCancelled()
    },
  })

  const remindedRecently =
    request.remindedAt !== null && openedAt - Date.parse(request.remindedAt) < DAY_MS
  const error = remind.error ?? cancel.error

  return (
    <section className="request__actions" aria-label="Действия с запросом">
      <Button
        variant="secondary"
        icon="bell"
        block
        disabled={remindedRecently || remind.isPending}
        onClick={() => remind.mutate()}
      >
        {remind.isPending
          ? 'Готовим напоминание…'
          : remindedRecently && request.remindedAt
            ? `Напоминал ${formatRelativeDay(request.remindedAt)}`
            : 'Напомнить'}
      </Button>
      <Button variant="ghost" icon="close" block onClick={() => setConfirmCancel(true)}>
        Отменить запрос
      </Button>
      {(note || error) && (
        <p className={error ? 'request__error' : 'request__muted'} role="status">
          {error ? apiErrorMessage(error, 'Не получилось — попробуй ещё раз') : note}
        </p>
      )}

      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Отменить запрос?"
        actions={
          <>
            <Button
              variant="danger"
              block
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? 'Отменяем…' : 'Отменить запрос'}
            </Button>
            <Button variant="ghost" block onClick={() => setConfirmCancel(false)}>
              Оставить
            </Button>
          </>
        }
      >
        <p className="request__muted">
          Ссылка перестанет принимать оплату. Долг {request.memberName} останется — его можно
          запросить снова.
        </p>
      </Modal>
    </section>
  )
}
