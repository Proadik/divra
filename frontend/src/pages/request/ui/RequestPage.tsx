import type { ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router'
import { groupPath } from '@/shared/config'
import { Button, IconButton } from '@/shared/ui'
import { useRequest } from '../model/use-request'
import { RequestPick } from './RequestPick'
import { RequestShare } from './RequestShare'
import { SentRequestActions } from './SentRequestActions'
import { SentRequests } from './SentRequests'
import './RequestPage.css'

/** Запросить: выбрать должников → ссылка и QR Solana Pay на каждого. */
export const RequestPage = (): ReactElement => {
  const { groupId = '' } = useParams()
  const navigate = useNavigate()
  const model = useRequest(groupId)
  const back = (): void => {
    void navigate(groupPath(groupId))
  }
  const created = model.requests
  const reopened = model.reopened
  const sentList = <SentRequests items={model.sent} onOpen={model.reopen} />

  const body = ((): ReactElement => {
    if (model.isLoading) {
      return (
        <p className="request__muted request__state" role="status">
          Загружаем…
        </p>
      )
    }
    if (model.loadError || !model.group) {
      return (
        <p role="alert" className="request__muted request__state">
          Не удалось загрузить группу
        </p>
      )
    }
    if (created) {
      return <RequestShare requests={created} message={model.message} />
    }
    if (reopened) {
      return (
        <>
          <RequestShare requests={[reopened]} message={`Напоминаю про «${model.group.name}»`} />
          <SentRequestActions
            groupId={groupId}
            request={reopened}
            onCancelled={() => model.reopen(null)}
          />
        </>
      )
    }
    if (model.rows.length === 0) {
      return (
        <>
          <div className="request__state">
            <p className="request__muted">В этой группе тебе никто не должен</p>
            <Button variant="secondary" onClick={back}>
              Вернуться в группу
            </Button>
          </div>
          {sentList}
        </>
      )
    }
    return <RequestPick model={model}>{sentList}</RequestPick>
  })()

  return (
    <main className="request page-enter">
      <header className="request__header">
        <IconButton
          icon={created ? 'close' : 'arrow-left'}
          label={created ? 'Закрыть' : 'Назад'}
          // Из открытого заново запроса — назад к списку, а не в группу
          onClick={reopened && !created ? () => model.reopen(null) : back}
        />
        <div className="request__titles">
          <h1 className="request__title">{created ? 'Запрос создан' : 'Запросить'}</h1>
          {model.group && <span className="request__muted">{model.group.name}</span>}
        </div>
        <span className="request__spacer" aria-hidden />
      </header>
      {body}
    </main>
  )
}
