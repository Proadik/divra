import { env } from '@/shared/config'

/**
 * Источник флагов. load — прочитать все значения; subscribe — получать изменения сразу,
 * без ожидания опроса (если источник это умеет).
 */
export type FlagsSource = {
  kind: 'local' | 'remote'
  load: () => Promise<unknown>
  subscribe?: (onChange: (raw: unknown) => void) => () => void
}

const LOCAL_KEY = 'divra.mock-flags'
const LOCAL_EVENT = 'divra:mock-flags'

const readLocal = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/**
 * «База» флагов в localStorage — для мока и разработки. Изменение подхватывают
 * все вкладки браузера сразу: другие — через событие storage, эта — через своё событие.
 */
export const localFlagsSource: FlagsSource = {
  kind: 'local',
  load: () => Promise.resolve(readLocal()),
  subscribe: (onChange) => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === LOCAL_KEY) {
        onChange(readLocal())
      }
    }
    const onLocal = (): void => onChange(readLocal())
    window.addEventListener('storage', onStorage)
    window.addEventListener(LOCAL_EVENT, onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(LOCAL_EVENT, onLocal)
    }
  },
}

/** Записать значение в локальную «базу». null — убрать запись, вернуть дефолт. */
export const writeLocalFlag = (name: string, value: boolean | null): void => {
  const next = readLocal()
  if (value === null) {
    delete next[name]
  } else {
    next[name] = value
  }
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next))
  } catch {
    // Нет доступа к storage — значение не сохранится
  }
  window.dispatchEvent(new Event(LOCAL_EVENT))
}

/** Поток изменений: бэкенд шлёт полный объект флагов при каждом изменении в базе. */
const subscribeToStream = (onChange: (raw: unknown) => void): (() => void) => {
  const stream = new EventSource(`${env.API_URL}/flags/stream`, { withCredentials: true })
  stream.onmessage = (event: MessageEvent<string>) => {
    try {
      onChange(JSON.parse(event.data) as unknown)
    } catch {
      // Битое сообщение — дождёмся следующего или опроса
    }
  }
  return () => stream.close()
}

/**
 * Флаги с бэкенда: `GET /flags` → `{ "mock.groups": false, … }`.
 * С VITE_FLAGS_STREAM — ещё и `GET /flags/stream` (Server-Sent Events).
 * EventSource сам переподключается после обрыва.
 *
 * Флаги идут мимо shared/api: API-функции сами зависят от флагов, так нет цикла.
 */
export const remoteFlagsSource: FlagsSource = {
  kind: 'remote',
  load: async () => {
    const response = await fetch(`${env.API_URL}/flags`, { credentials: 'include' })
    if (!response.ok) {
      throw new Error(`GET /flags: ${response.status}`)
    }
    return (await response.json()) as unknown
  },
  subscribe: env.FLAGS_STREAM ? subscribeToStream : undefined,
}

export const flagsSource: FlagsSource =
  env.FLAGS_SOURCE === 'remote' ? remoteFlagsSource : localFlagsSource
