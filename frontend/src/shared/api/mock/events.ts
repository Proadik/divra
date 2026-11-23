import type { ServerEvent } from '../events'

type Listener = (event: ServerEvent) => void

/**
 * События мока: вместо WebSocket — подписка в той же вкладке. Мок сообщает об изменениях,
 * которые в реальности пришли бы с сервера (например, замеченный перевод).
 */
const listeners = new Set<Listener>()

export const mockEvents = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  emit(event: ServerEvent): void {
    for (const listener of listeners) {
      listener(event)
    }
  },
}
