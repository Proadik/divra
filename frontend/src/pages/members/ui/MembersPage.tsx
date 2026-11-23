import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactElement, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  type GroupMember,
  apiErrorMessage,
  createInvite,
  getGroupOverview,
  groupKeys,
  inviteKeys,
} from '@/shared/api'
import { ROUTES, groupPath } from '@/shared/config'
import { pluralize } from '@/shared/lib/format'
import { Avatar, type AvatarTone, Button, IconButton, ListGroup, ListRow } from '@/shared/ui'
import { ActiveInvites } from './ActiveInvites'
import { AddByNameForm } from './AddByNameForm'
import { InviteLinkCard } from './InviteLinkCard'
import { RemoveMemberDialog } from './RemoveMemberDialog'
import './MembersPage.css'

const toneOf = (index: number): AvatarTone => ((index % 4) + 1) as AvatarTone

const statusText = (member: GroupMember): string => {
  if (member.isMe) {
    return 'это ты'
  }
  return member.status === 'active' ? 'кошелёк подключён' : 'без кошелька'
}

export const MembersPage = (): ReactElement => {
  const { groupId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<GroupMember | null>(null)
  const overview = useQuery({
    queryKey: groupKeys.overview(groupId),
    queryFn: () => getGroupOverview(groupId),
  })
  const invite = useMutation({
    mutationFn: (claimMemberId: string | null) =>
      createInvite(groupId, claimMemberId ? { claimMemberId } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inviteKeys.active(groupId) }),
  })
  const me = overview.data?.members.find((member) => member.isMe)

  const members = overview.data?.members ?? []
  const claimName = invite.data?.claimMemberId
    ? (members.find((member) => member.id === invite.data?.claimMemberId)?.name ?? null)
    : null

  return (
    <main className="members page-enter">
      <header className="members__header">
        <IconButton
          icon="arrow-left"
          label="К группе"
          onClick={() => void navigate(groupPath(groupId))}
        />
        <h1 className="members__title">Участники</h1>
        <span className="members__spacer" aria-hidden />
      </header>

      <ListGroup
        title="В группе"
        aside={pluralize(members.length, { one: 'человек', few: 'человека', many: 'человек' })}
      >
        {overview.isPending && (
          <p className="members__note" role="status">
            Загружаем…
          </p>
        )}
        {members.map((member, index) => (
          <ListRow
            key={member.id}
            leading={<Avatar initials={member.initials} tone={toneOf(index)} title={member.name} />}
            title={member.name}
            subtitle={statusText(member)}
            trailing={
              member.status === 'pending' ? (
                <span className="members__row-actions">
                  <Button
                    variant="ghost"
                    icon="link"
                    disabled={invite.isPending}
                    onClick={() => invite.mutate(member.id)}
                  >
                    Ссылка
                  </Button>
                  <IconButton
                    icon="trash"
                    label={`Удалить ${member.name}`}
                    onClick={() => setRemoving(member)}
                  />
                </span>
              ) : undefined
            }
          />
        ))}
      </ListGroup>

      <section className="members__section" aria-labelledby="invite-title">
        <h2 id="invite-title" className="members__section-title">
          Пригласить по ссылке
        </h2>
        <p className="members__note">
          Друг перейдёт по ссылке, подключит кошелёк и сразу окажется в группе. С ним можно будет
          рассчитываться в USDC.
        </p>
        {invite.data && overview.data ? (
          <InviteLinkCard
            invite={invite.data}
            groupName={overview.data.name}
            claimName={claimName}
          />
        ) : (
          <Button icon="link" block disabled={invite.isPending} onClick={() => invite.mutate(null)}>
            {invite.isPending ? 'Создаём ссылку…' : 'Создать ссылку'}
          </Button>
        )}
        {invite.data?.claimMemberId && (
          <Button variant="ghost" onClick={() => invite.mutate(null)}>
            Нужна общая ссылка
          </Button>
        )}
        {invite.error && (
          <p className="members__error" role="alert">
            {apiErrorMessage(invite.error, 'Не удалось создать ссылку')}
          </p>
        )}
      </section>

      <section className="members__section" aria-labelledby="by-name-title">
        <h2 id="by-name-title" className="members__section-title">
          Добавить по имени
        </h2>
        <p className="members__note">
          Без кошелька и входа — можно сразу записывать на него расходы. Рассчитаться в USDC
          получится, когда он подключит кошелёк по своей персональной ссылке.
        </p>
        <AddByNameForm groupId={groupId} />
      </section>

      <ActiveInvites groupId={groupId} />

      {me && (
        <Button variant="ghost" icon="logout" block onClick={() => setRemoving(me)}>
          Выйти из группы
        </Button>
      )}

      <RemoveMemberDialog
        groupId={groupId}
        member={removing}
        onClose={() => setRemoving(null)}
        onLeft={() => void navigate(ROUTES.home)}
      />
    </main>
  )
}
