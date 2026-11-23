import { type ReactElement, useState } from 'react'
import { apiErrorMessage } from '@/shared/api'
import { Button, Modal } from '@/shared/ui'
import { useDeleteAccount } from '../model/use-delete-account'
import './DeleteAccountButton.css'

/** Удалить аккаунт — с подтверждением: действие необратимо */
export const DeleteAccountButton = (): ReactElement => {
  const [open, setOpen] = useState(false)
  const mutation = useDeleteAccount()
  const close = (): void => {
    mutation.reset()
    setOpen(false)
  }
  return (
    <>
      <Button variant="ghost" icon="trash" onClick={() => setOpen(true)}>
        Удалить аккаунт
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Удалить аккаунт?"
        actions={
          <>
            <Button
              variant="danger"
              block
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Удаляем…' : 'Удалить навсегда'}
            </Button>
            <Button variant="ghost" block onClick={close}>
              Отмена
            </Button>
          </>
        }
      >
        <p className="delete-account__text">
          Кошельки отвяжутся, все сессии закончатся. В группах ты останешься участником без кошелька
          с тем же именем — расходы и долги друзей не пропадут. Открытые запросы на оплату
          отменятся. Войти тем же кошельком можно снова, но это будет новый аккаунт.
        </p>
        {mutation.error && (
          <p className="delete-account__error" role="alert">
            {apiErrorMessage(mutation.error, 'Не получилось удалить аккаунт')}
          </p>
        )}
      </Modal>
    </>
  )
}
