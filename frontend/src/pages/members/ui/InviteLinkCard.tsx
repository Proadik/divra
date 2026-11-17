import { type ReactElement, useState } from 'react'
import type { Invite } from '@/shared/api'
import { Button } from '@/shared/ui'

export type InviteLinkCardProps = {
  invite: Invite
  groupName: string
  /** Имя участника для персональной ссылки */
  claimName: string | null
}

const untilFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

const canShare = (): boolean => typeof navigator !== 'undefined' && 'share' in navigator

export const InviteLinkCard = ({
  invite,
  groupName,
  claimName,
}: InviteLinkCardProps): ReactElement => {
  const [copied, setCopied] = useState(false)
  const until = untilFormat.format(new Date(invite.expiresAt))

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(invite.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const share = async (): Promise<void> => {
    try {
      await navigator.share({
        title: 'Divra',
        text: claimName
          ? `${claimName}, это ссылка, чтобы подключить кошелёк в группе «${groupName}» в Divra`
          : `Присоединяйся к группе «${groupName}» в Divra`,
        url: invite.url,
      })
    } catch {
      // Пользователь закрыл системное окно — ничего не делаем
    }
  }

  return (
    <div className="members__invite" aria-live="polite">
      <div className="members__invite-title">
        {claimName ? `Персональная ссылка для «${claimName}»` : 'Ссылка-приглашение'}
      </div>
      <input
        className="members__invite-url"
        value={invite.url}
        readOnly
        aria-label="Ссылка-приглашение"
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="members__invite-actions">
        {canShare() && (
          <Button icon="link" onClick={() => void share()}>
            Поделиться
          </Button>
        )}
        <Button variant="secondary" icon={copied ? 'check' : undefined} onClick={() => void copy()}>
          {copied ? 'Скопировано' : 'Скопировать'}
        </Button>
      </div>
      <p className="members__note">
        {claimName
          ? `По ссылке ${claimName} подключит кошелёк и получит всю свою историю расходов. Действует до ${until}.`
          : `Кто перейдёт по ссылке, подключит кошелёк и окажется в группе. Действует до ${until}.`}
      </p>
    </div>
  )
}
