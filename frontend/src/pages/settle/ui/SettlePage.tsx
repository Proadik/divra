import type { ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useWalletGuard } from '@/entities/wallet'
import { groupPath } from '@/shared/config'
import { Button, IconButton } from '@/shared/ui'
import { useSettle } from '../model/use-settle'
import { SettleDone } from './SettleDone'
import { SettlePick } from './SettlePick'
import { SettleProgress } from './SettleProgress'
import './SettlePage.css'

/** Рассчитаться: выбрать, кому и сколько → подписать одну транзакцию → готово. */
export const SettlePage = (): ReactElement => {
  const { groupId = '' } = useParams()
  const navigate = useNavigate()
  const settle = useSettle(groupId)
  // Подписывать можно только аккаунтом сессии — иначе модалка «Переподключить»
  const { requireWallet, dialog } = useWalletGuard()
  const back = (): void => {
    void navigate(groupPath(groupId))
  }
  const busy = settle.phase !== 'idle' && settle.phase !== 'done'

  const body = ((): ReactElement => {
    if (settle.isLoading) {
      return (
        <p className="settle__muted settle__state" role="status">
          Загружаем долги…
        </p>
      )
    }
    if (settle.loadError || !settle.group) {
      return (
        <p role="alert" className="settle__muted settle__state">
          Не удалось загрузить группу
        </p>
      )
    }
    if (settle.phase === 'done' && settle.result) {
      return (
        <SettleDone
          result={settle.result}
          groupName={settle.group.name}
          settledAll={settle.rows.length === 0}
          onBack={back}
        />
      )
    }
    if (busy) {
      return <SettleProgress settle={settle} />
    }
    if (settle.rows.length === 0) {
      return (
        <div className="settle__state">
          <p className="settle__muted">Ты никому не должен в этой группе</p>
          <Button variant="secondary" onClick={back}>
            Вернуться в группу
          </Button>
        </div>
      )
    }
    return (
      <SettlePick settle={settle} groupId={groupId} onSubmit={() => requireWallet(settle.start)} />
    )
  })()

  return (
    <main className="settle page-enter">
      <header className="settle__header">
        <IconButton
          icon={busy ? 'close' : 'arrow-left'}
          label={busy ? 'Отменить' : 'Назад'}
          disabled={settle.phase === 'sending'}
          onClick={back}
        />
        <div className="settle__titles">
          <h1 className="settle__title">{settle.phase === 'done' ? 'Готово' : 'Рассчитаться'}</h1>
          {settle.group && <span className="settle__subtitle">{settle.group.name}</span>}
        </div>
        <span className="settle__spacer" aria-hidden />
      </header>
      {body}
      {dialog}
    </main>
  )
}
