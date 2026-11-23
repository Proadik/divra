import { io } from 'socket.io-client'
import { z } from 'zod'
import { env } from '@/shared/config'

/**
 * События с бэкенда (socket.io поверх WebSocket). Тонкие: только «что изменилось» —
 * данные клиент перечитывает обычными запросами. Контракт — backend/src/events/events.gateway.ts.
 */
export type ServerEvent =
  | { type: 'group.changed'; groupId: string }
  | { type: 'transfer.detected'; id: string }
  | { type: 'history.changed' }

const groupChangedSchema = z.object({ groupId: z.string().min(1) })
const transferDetectedSchema = z.object({ id: z.string().min(1) })

export type EventsConnection = {
  /** Переподключиться (после обновления токена) */
  reconnect: () => void
  close: () => void
}

export type ConnectEventsOptions = {
  /** Текущий access-токен — берётся при каждом (пере)подключении */
  getToken: () => string | null
  onEvent: (event: ServerEvent) => void
  /** Сервер отклонил токен или закрыл соединение, когда токен истёк */
  onUnauthorized: () => void
}

/** Адрес и путь socket.io из VITE_API_URL: `/api` → тот же origin, путь `/api/socket.io` */
const socketTarget = (): { origin: string; path: string } => {
  const base = new URL(env.API_URL || '/', window.location.origin)
  return { origin: base.origin, path: `${base.pathname.replace(/\/$/, '')}/socket.io` }
}

/**
 * Подключение к событиям. Токен уходит в handshake (`auth`), а не в URL — URL попадает в логи.
 * В режиме мока событий шлёт сам мок (shared/api/mock/events).
 */
export const connectEvents = (options: ConnectEventsOptions): EventsConnection => {
  if (env.GROUPS_MOCK) {
    let unsubscribe: (() => void) | null = null
    let closed = false
    void import('../mock/events').then(({ mockEvents }) => {
      if (!closed) {
        unsubscribe = mockEvents.subscribe(options.onEvent)
      }
    })
    return {
      reconnect: () => undefined,
      close: () => {
        closed = true
        unsubscribe?.()
      },
    }
  }

  const { origin, path } = socketTarget()
  const socket = io(origin, {
    path,
    transports: ['websocket'],
    auth: (callback) => callback({ token: options.getToken() }),
  })
  socket.on('group.changed', (payload: unknown) => {
    const parsed = groupChangedSchema.safeParse(payload)
    if (parsed.success) {
      options.onEvent({ type: 'group.changed', groupId: parsed.data.groupId })
    }
  })
  socket.on('transfer.detected', (payload: unknown) => {
    const parsed = transferDetectedSchema.safeParse(payload)
    if (parsed.success) {
      options.onEvent({ type: 'transfer.detected', id: parsed.data.id })
    }
  })
  socket.on('history.changed', () => options.onEvent({ type: 'history.changed' }))
  // Сам сервер закрыл соединение (токен отклонён или истёк) — socket.io не переподключается
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') {
      options.onUnauthorized()
    }
  })
  return {
    reconnect: () => {
      if (!socket.connected) {
        socket.connect()
      }
    },
    close: () => {
      socket.removeAllListeners()
      socket.disconnect()
    },
  }
}
