import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactElement, useState } from 'react'
import {
  type GroupMember,
  apiErrorMessage,
  groupKeys,
  paymentKeys,
  recordCashPayment,
} from '@/shared/api'
import { Button, Modal, TextField } from '@/shared/ui'

const parseDollars = (text: string): number => Number(text.replace(',', '.').replace(/\s/g, ''))

/**
 * «Вернули наличными»: отмечает тот, кому должны. Сумма в долларах (стейблкоин 1:1),
 * не больше долга — бэкенд перепроверит. Открытый запрос этому участнику закроется.
 */
export const CashDialog = ({
  groupId,
  debtor,
  owed,
  onClose,
}: {
  groupId: string
  debtor: GroupMember | null
  /** Сколько debtor должен тебе, в долларах */
  owed: number
  onClose: () => void
}): ReactElement => {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const amount = text ? parseDollars(text) : owed
  const valid =
    Number.isFinite(amount) && amount > 0 && Math.round(amount * 100) <= Math.round(owed * 100)
  const mutation = useMutation({
    mutationFn: () => recordCashPayment(groupId, { memberId: debtor?.id ?? '', amount }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: groupKeys.all }),
        queryClient.invalidateQueries({ queryKey: paymentKeys.sent(groupId) }),
      ])
      setText('')
      onClose()
    },
  })
  const close = (): void => {
    setText('')
    mutation.reset()
    onClose()
  }

  return (
    <Modal
      open={debtor !== null}
      onClose={close}
      title={`${debtor?.name ?? ''} вернул наличными`}
      actions={
        <>
          <Button block disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Записываем…' : 'Отметить возврат'}
          </Button>
          <Button variant="ghost" block onClick={close}>
            Отмена
          </Button>
        </>
      }
    >
      <p className="group-page__modal-text">
        Долг уменьшится без перевода в сети. Отмечает только тот, кому должны.
      </p>
      <TextField
        label="Сколько вернул, $"
        inputMode="decimal"
        placeholder={owed.toFixed(2)}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      {!valid && text && (
        <p className="group-page__modal-error" role="alert">
          Сумма от 0.01 до {owed.toFixed(2)}
        </p>
      )}
      {mutation.error && (
        <p className="group-page__modal-error" role="alert">
          {apiErrorMessage(mutation.error, 'Не получилось записать — попробуй ещё раз')}
        </p>
      )}
    </Modal>
  )
}
