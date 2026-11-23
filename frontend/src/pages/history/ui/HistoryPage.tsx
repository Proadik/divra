import { useInfiniteQuery } from '@tanstack/react-query'
import { type ReactElement, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { HistoryRow } from '@/entities/history'
import { getHistory, historyKeys } from '@/shared/api'
import { ROUTES } from '@/shared/config'
import { Button, IconButton, ListGroup } from '@/shared/ui'
import './HistoryPage.css'

const PAGE_SIZE = 20

/**
 * Все переводы в сети с твоим участием. Бесконечная прокрутка: когда низ списка показывается
 * на экране (IntersectionObserver), подгружается следующая страница по курсору бэкенда.
 * Кнопка «Показать ещё» — на случай, если наблюдатель недоступен.
 */
export const HistoryPage = (): ReactElement => {
  const navigate = useNavigate()
  const sentinel = useRef<HTMLDivElement>(null)
  const history = useInfiniteQuery({
    queryKey: historyKeys.list(),
    queryFn: ({ pageParam }) => getHistory({ cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history

  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasNextPage || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage()
        }
      },
      // Подгружаем заранее, за экран до конца списка
      { rootMargin: '600px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const items = history.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <main className="history page-enter">
      <header className="history__header">
        <IconButton
          icon="arrow-left"
          label="На главную"
          onClick={() => void navigate(ROUTES.home)}
        />
        <h1 className="history__title">История</h1>
        <span className="history__spacer" aria-hidden />
      </header>

      <p className="history__hint">
        Переводы USDC и USDT в сети с твоими кошельками: по запросам Divra, расчёты и переводы
        напрямую из кошелька.
      </p>

      <ListGroup>
        {history.isPending && (
          <p className="history__note" role="status">
            Загружаем…
          </p>
        )}
        {history.isError && !history.data && (
          <p className="history__note" role="alert">
            Не удалось загрузить историю
          </p>
        )}
        {history.isSuccess && items.length === 0 && (
          <p className="history__note">Переводов в сети пока не было</p>
        )}
        {items.map((item) => (
          <HistoryRow key={item.id} item={item} />
        ))}
      </ListGroup>

      <div ref={sentinel} className="history__more">
        {isFetchingNextPage && (
          <p className="history__note" role="status">
            Загружаем ещё…
          </p>
        )}
        {hasNextPage && !isFetchingNextPage && (
          <Button variant="ghost" onClick={() => void fetchNextPage()}>
            Показать ещё
          </Button>
        )}
        {history.isFetchNextPageError && (
          <p className="history__note" role="alert">
            Не удалось загрузить — попробуй ещё раз
          </p>
        )}
        {history.isSuccess && !hasNextPage && items.length > 0 && (
          <p className="history__note">Это все переводы</p>
        )}
      </div>
    </main>
  )
}
