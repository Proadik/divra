import { useQuery } from '@tanstack/react-query'
import { type ReactElement, useState } from 'react'
import { useNavigate } from 'react-router'
import { DetectedTransfers } from '@/features/detected-transfers'
import { getHomeOverview, groupKeys } from '@/shared/api'
import { addExpensePath } from '@/shared/config'
import { Button, Fab, Modal } from '@/shared/ui'
import { ActivitySection } from './ActivitySection'
import { CreateGroupDialog } from './CreateGroupDialog'
import { GroupsSection } from './GroupsSection'
import { HistorySection } from './HistorySection'
import { HomeHeader } from './HomeHeader'
import { PickGroupList } from './PickGroupDialog'
import { TotalsCard } from './TotalsCard'
import './HomePage.css'

type Dialog = 'create' | 'pick' | null

/** Главная: итог по всем группам, список групп, недавние события. */
export const HomePage = (): ReactElement => {
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<Dialog>(null)
  const home = useQuery({ queryKey: groupKeys.home(), queryFn: getHomeOverview })
  const close = (): void => setDialog(null)

  if (home.isPending) {
    return (
      <main className="home home--state">
        <p role="status">Загружаем группы…</p>
      </main>
    )
  }

  if (home.isError) {
    return (
      <main className="home home--state">
        <p role="alert">Не удалось загрузить группы</p>
        <Button variant="secondary" onClick={() => void home.refetch()}>
          Повторить
        </Button>
      </main>
    )
  }

  const { data } = home
  const [onlyGroup] = data.groups

  const addExpense = (): void => {
    if (data.groups.length === 1 && onlyGroup) {
      void navigate(addExpensePath(onlyGroup.id))
      return
    }
    setDialog(data.groups.length === 0 ? 'create' : 'pick')
  }

  return (
    <main className="home page-enter">
      <HomeHeader />
      <TotalsCard data={data} />
      <DetectedTransfers />
      <GroupsSection groups={data.groups} onCreate={() => setDialog('create')} />
      <ActivitySection items={data.activity} />
      <HistorySection />

      <CreateGroupDialog open={dialog === 'create'} onClose={close} />
      <Modal open={dialog === 'pick'} onClose={close} title="В какую группу?">
        <PickGroupList groups={data.groups} onClose={close} />
      </Modal>

      {/* sticky: прилипает к низу экрана, а в конце страницы встаёт на своё место */}
      <div className="home__fab page-enter-action">
        <Fab onClick={addExpense}>Добавить расход</Fab>
      </div>
    </main>
  )
}
