import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useStablecoin } from '@/entities/currency'
import type { GroupOverview } from '@/shared/api'
import { ROUTES, membersPath, requestPath } from '@/shared/config'
import { pluralize } from '@/shared/lib/format'
import { Button, IconButton } from '@/shared/ui'

const MENU_ID = 'group-menu'

export const GroupHeader = ({ group }: { group: GroupOverview }): ReactElement => {
  const navigate = useNavigate()
  const stablecoin = useStablecoin()
  const members = pluralize(group.members.length, {
    one: 'участник',
    few: 'участника',
    many: 'участников',
  })

  return (
    <header className="group-page__header">
      <IconButton icon="arrow-left" label="Все группы" onClick={() => void navigate(ROUTES.home)} />
      <div className="group-page__heading">
        <h1 className="group-page__title">{group.name}</h1>
        <button
          type="button"
          className="group-page__subtitle"
          onClick={() => void navigate(membersPath(group.id))}
        >
          {members} · {stablecoin}
        </button>
      </div>
      <IconButton icon="more" label="Меню" popoverTarget={MENU_ID} />

      <div id={MENU_ID} popover="auto" className="group-page__menu">
        <Button variant="ghost" icon="users" onClick={() => void navigate(membersPath(group.id))}>
          Участники и приглашения
        </Button>
        <Button variant="ghost" icon="send" onClick={() => void navigate(requestPath(group.id))}>
          Запросы на оплату
        </Button>
        <Button variant="ghost" icon="sliders" onClick={() => void navigate(ROUTES.settings)}>
          Настройки
        </Button>
      </div>
    </header>
  )
}
