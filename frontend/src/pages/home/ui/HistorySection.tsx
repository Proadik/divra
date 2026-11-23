import { useQuery } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { HistoryRow } from '@/entities/history'
import { HISTORY_PREVIEW_LIMIT, getHistory, historyKeys } from '@/shared/api'
import { ROUTES } from '@/shared/config'
import { Button, ListGroup } from '@/shared/ui'

/** Последние переводы в сети с твоим участием; «Все» — страница с бесконечной прокруткой */
export const HistorySection = (): ReactElement => {
  const navigate = useNavigate()
  const history = useQuery({
    queryKey: historyKeys.preview(),
    queryFn: () => getHistory({ limit: HISTORY_PREVIEW_LIMIT }),
  })
  const items = history.data?.items ?? []

  return (
    <ListGroup
      title="История"
      aside={
        <Button variant="ghost" onClick={() => void navigate(ROUTES.history)}>
          Все
        </Button>
      }
    >
      {history.isPending && (
        <p className="home__note" role="status">
          Загружаем переводы…
        </p>
      )}
      {history.isError && (
        <p className="home__note" role="alert">
          История не загрузилась
        </p>
      )}
      {history.isSuccess && items.length === 0 && (
        <p className="home__note">Переводов в сети пока не было</p>
      )}
      {items.map((item) => (
        <HistoryRow key={item.id} item={item} />
      ))}
    </ListGroup>
  )
}
