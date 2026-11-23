import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import {
  type GroupMember,
  apiErrorMessage,
  groupKeys,
  inviteKeys,
  removeMember,
} from '@/shared/api'
import { Button, Modal } from '@/shared/ui'

/**
 * Удалить участника без кошелька или выйти из группы самому. Бэкенд разрешит, только если
 * долгов нет ни у него, ни перед ним (иначе 409 — покажем сообщение).
 */
export const RemoveMemberDialog = ({
  groupId,
  member,
  onClose,
  onLeft,
}: {
  groupId: string
  member: GroupMember | null
  onClose: () => void
  onLeft: () => void
}): ReactElement => {
  const queryClient = useQueryClient()
  const leaving = member?.isMe ?? false
  const mutation = useMutation({
    mutationFn: (memberId: string) => removeMember(groupId, memberId),
    onSuccess: async (result) => {
      if (result.left) {
        queryClient.removeQueries({ queryKey: [...groupKeys.all, groupId] })
        await queryClient.invalidateQueries({ queryKey: groupKeys.home() })
        onLeft()
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: groupKeys.all }),
        queryClient.invalidateQueries({ queryKey: inviteKeys.active(groupId) }),
      ])
      onClose()
    },
  })
  const close = (): void => {
    mutation.reset()
    onClose()
  }

  return (
    <Modal
      open={member !== null}
      onClose={close}
      title={leaving ? 'Выйти из группы?' : `Удалить ${member?.name ?? ''}?`}
      actions={
        <>
          <Button
            variant="danger"
            block
            disabled={mutation.isPending}
            onClick={() => member && mutation.mutate(member.id)}
          >
            {mutation.isPending ? 'Подожди…' : leaving ? 'Выйти' : 'Удалить'}
          </Button>
          <Button variant="ghost" block onClick={close}>
            Отмена
          </Button>
        </>
      }
    >
      <p className="members__note">
        {leaving
          ? 'Группа пропадёт из твоего списка. Вернуться можно по ссылке-приглашению. Выйти можно, только когда вы рассчитались.'
          : 'Его прошлые расходы останутся в истории. Удалить можно, только если у него нет долгов и ему никто не должен.'}
      </p>
      {mutation.error && (
        <p className="members__error" role="alert">
          {apiErrorMessage(mutation.error, 'Не получилось — попробуй ещё раз')}
        </p>
      )}
    </Modal>
  )
}
