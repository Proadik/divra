import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { apiErrorMessage, getActiveInvites, inviteKeys, revokeInvite } from '@/shared/api'
import { formatRelativeDay } from '@/shared/lib/format'
import { Button, ListGroup, ListRow } from '@/shared/ui'

/** Действующие ссылки группы. Отозванная ссылка больше не пускает в группу */
export const ActiveInvites = ({ groupId }: { groupId: string }): ReactElement | null => {
  const queryClient = useQueryClient()
  const invites = useQuery({
    queryKey: inviteKeys.active(groupId),
    queryFn: () => getActiveInvites(groupId),
  })
  const revoke = useMutation({
    mutationFn: (code: string) => revokeInvite(groupId, code),
    onSettled: () => queryClient.invalidateQueries({ queryKey: inviteKeys.active(groupId) }),
  })

  const items = invites.data ?? []
  if (items.length === 0) {
    return null
  }
  return (
    <ListGroup title="Действующие ссылки" aside={`${items.length}`}>
      {items.map((item) => (
        <ListRow
          key={item.code}
          icon="link"
          title={item.claimMemberName ? `Для ${item.claimMemberName}` : 'Общая ссылка'}
          subtitle={`${item.invitedByName} · действует до ${formatRelativeDay(item.expiresAt)}`}
          trailing={
            <Button
              variant="ghost"
              disabled={revoke.isPending && revoke.variables === item.code}
              onClick={() => revoke.mutate(item.code)}
            >
              Отозвать
            </Button>
          }
        />
      ))}
      {revoke.error && (
        <p className="members__error" role="alert">
          {apiErrorMessage(revoke.error, 'Не удалось отозвать ссылку')}
        </p>
      )}
    </ListGroup>
  )
}
