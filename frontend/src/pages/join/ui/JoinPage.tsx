import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useWalletSession } from '@/entities/wallet'
import {
  acceptInvite,
  apiErrorMessage,
  getInvitePreview,
  groupKeys,
  inviteKeys,
} from '@/shared/api'
import { ROUTES, groupPath } from '@/shared/config'
import { pluralize } from '@/shared/lib/format'
import { clearPendingInvite, setPendingInvite } from '@/shared/lib/pending-invite'
import { Button, Logo } from '@/shared/ui'
import './JoinPage.css'

const errorText = (error: Error): string => apiErrorMessage(error, 'Ссылка недействительна')

export const JoinPage = (): ReactElement => {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isVerified = useWalletSession((state) => state.status === 'verified')

  const preview = useQuery({
    queryKey: inviteKeys.preview(code),
    queryFn: () => getInvitePreview(code),
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () => acceptInvite(code),
    onSuccess: async () => {
      clearPendingInvite()
      await queryClient.invalidateQueries({ queryKey: groupKeys.all })
    },
  })

  const goHome = (): void => {
    clearPendingInvite()
    void navigate(ROUTES.home, { replace: true })
  }

  const connectFirst = (): void => {
    // Код переживёт /connect → /verify, после подписи SessionGate вернёт сюда
    setPendingInvite(code)
    void navigate(ROUTES.connect)
  }

  const renderBody = (): ReactElement => {
    if (preview.isPending) {
      return <p className="join__muted">Проверяем приглашение…</p>
    }
    if (preview.isError) {
      return (
        <>
          <h1 className="join__title">Приглашение не работает</h1>
          <p className="join__muted">{errorText(preview.error)}. Попроси новую ссылку у друга.</p>
          <Button variant="secondary" block onClick={goHome}>
            На главную
          </Button>
        </>
      )
    }

    const invite = preview.data
    if (accept.isSuccess) {
      return (
        <>
          <h1 className="join__title">
            {accept.data.alreadyMember ? 'Ты уже в этой группе' : 'Готово, ты в группе'}
          </h1>
          <p className="join__muted">«{invite.groupName}»</p>
          <Button
            size="lg"
            block
            onClick={() => {
              clearPendingInvite()
              void navigate(groupPath(accept.data.groupId), { replace: true })
            }}
          >
            Открыть группу
          </Button>
        </>
      )
    }

    return (
      <>
        <p className="join__eyebrow">{invite.invitedByName} приглашает тебя</p>
        <h1 className="join__title">{invite.groupName}</h1>
        <p className="join__muted">
          {pluralize(invite.membersCount, {
            one: 'участник',
            few: 'участника',
            many: 'участников',
          })}{' '}
          · USDC
        </p>
        {invite.claimMemberName && (
          <p className="join__claim">
            Ты присоединишься как «{invite.claimMemberName}» — вместе со всеми расходами и долгами,
            которые уже записаны на это имя.
          </p>
        )}
        {accept.isError && (
          <p className="join__error" role="alert">
            {errorText(accept.error)}
          </p>
        )}
        {isVerified ? (
          <Button size="lg" block disabled={accept.isPending} onClick={() => accept.mutate()}>
            {accept.isPending ? 'Вступаем…' : 'Вступить в группу'}
          </Button>
        ) : (
          <>
            <Button size="lg" block icon="wallet" onClick={connectFirst}>
              Подключить кошелёк
            </Button>
            <p className="join__muted">
              Сначала подключи и подтверди кошелёк — после этого вернёшься сюда.
            </p>
          </>
        )}
        <Button variant="ghost" onClick={goHome}>
          Не сейчас
        </Button>
      </>
    )
  }

  return (
    <main className="join page-enter">
      <header className="join__header">
        <Logo height={28} />
      </header>
      <section className="join__card" aria-busy={preview.isPending}>
        {renderBody()}
      </section>
    </main>
  )
}
