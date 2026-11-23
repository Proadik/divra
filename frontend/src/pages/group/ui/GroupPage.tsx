import { useQuery } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router'
import { DetectedTransfers } from '@/features/detected-transfers'
import { useMoney } from '@/entities/currency'
import { getGroupOverview, groupKeys } from '@/shared/api'
import { addExpensePath, requestPath, settlePath } from '@/shared/config'
import { BalanceCard, Button, Fab } from '@/shared/ui'
import { balanceCaption, toPerson } from '../lib/group'
import { AmountsToggle } from './AmountsToggle'
import { DebtsSection } from './DebtsSection'
import { ExpensesSection } from './ExpensesSection'
import { GroupHeader } from './GroupHeader'
import './GroupPage.css'

export const GroupPage = (): ReactElement => {
  const { groupId = '' } = useParams()
  const money = useMoney()
  const navigate = useNavigate()
  const group = useQuery({
    queryKey: groupKeys.overview(groupId),
    queryFn: () => getGroupOverview(groupId),
  })

  if (group.isPending) {
    return (
      <main className="group-page group-page--state">
        <p role="status">Загружаем группу…</p>
      </main>
    )
  }

  if (group.isError) {
    return (
      <main className="group-page group-page--state">
        <p role="alert">Не удалось загрузить группу</p>
        <Button variant="secondary" onClick={() => void group.refetch()}>
          Повторить
        </Button>
      </main>
    )
  }

  const { data } = group
  const me = data.members.find((member) => member.isMe)
  // Кнопки активны, только когда есть что переводить или запрашивать
  const iOwe = data.debts.some((debt) => debt.fromId === me?.id)
  const owedToMe = data.debts.some((debt) => debt.toId === me?.id)

  return (
    <main className="group-page page-enter">
      <GroupHeader group={data} />
      <AmountsToggle money={money} />

      <BalanceCard
        value={money.fromUsd(data.myBalance)}
        animateValue
        currency={money.symbol}
        fractionDigits={money.fractionDigits}
        caption={balanceCaption(data.myBalance)}
        people={data.members.map((member) => toPerson(data, member))}
      >
        <Button disabled={!iOwe} onClick={() => void navigate(settlePath(groupId))}>
          Рассчитаться
        </Button>
        <Button
          variant="inverse"
          disabled={!owedToMe}
          onClick={() => void navigate(requestPath(groupId))}
        >
          Запросить
        </Button>
      </BalanceCard>

      <DetectedTransfers groupId={data.id} />
      <DebtsSection group={data} money={money} />
      <ExpensesSection group={data} money={money} />

      {/* sticky: прилипает к низу экрана, а в конце страницы встаёт на своё место */}
      <div className="group-page__fab page-enter-action">
        <Fab onClick={() => void navigate(addExpensePath(groupId))}>Добавить расход</Fab>
      </div>
    </main>
  )
}
