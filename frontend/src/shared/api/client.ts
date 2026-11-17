import { env } from '@/shared/config'

export class ApiError extends Error {
  readonly status: number

  readonly data: unknown

  constructor(status: number, data: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
  params?: Record<string, string | number | boolean | undefined>
  /** false — без Bearer-токена и без повтора после 401 (эндпоинты входа и обновления токена) */
  auth?: boolean
}

/**
 * Как клиент получает и обновляет access-токен. Подключает слой app: shared ничего
 * не знает о сторе сессии. Токен живёт в памяти вкладки, refresh — в HttpOnly-cookie.
 */
export type AuthBridge = {
  getToken: () => string | null
  /** Новый access-токен по refresh-cookie; null — сессии больше нет */
  refresh: () => Promise<string | null>
  /** Сессия истекла: токен не обновился */
  onExpired: () => void
}

let auth: AuthBridge | null = null

export const configureAuth = (bridge: AuthBridge | null): void => {
  auth = bridge
}

/** Заголовок нашего фронтенда: без него бэкенд не примет cookie-запросы (защита от CSRF) */
export const CLIENT_HEADER = { 'X-Divra-Client': 'web' } as const

/** VITE_API_URL — абсолютный адрес или путь (`/api` — тот же origin, через прокси) */
const buildUrl = (path: string, params?: RequestOptions['params']): string => {
  const base = new URL(env.API_URL || '/', window.location.origin)
  const url = new URL(`${base.pathname.replace(/\/$/, '')}${path}`, base.origin)

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    })
  }

  return url.toString()
}

const parseBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return null
  }

  const contentType = response.headers.get('content-type') ?? ''

  return contentType.includes('application/json') ? response.json() : response.text()
}

const send = (path: string, options: RequestOptions, token: string | null): Promise<Response> => {
  const { body, params, headers, auth: _auth, ...init } = options
  const isJson = body !== undefined && !(body instanceof FormData)
  return fetch(buildUrl(path, params), {
    // Cookie нужна только эндпоинтам входа; при прокси это тот же origin
    credentials: 'include',
    ...init,
    headers: {
      ...CLIENT_HEADER,
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: isJson ? JSON.stringify(body) : (body as BodyInit | undefined),
  })
}

export const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const useAuth = options.auth !== false && auth !== null
  const token = useAuth ? (auth?.getToken() ?? null) : null
  let response = await send(path, options, token)

  // Access-токен истёк — обновляем один раз и повторяем запрос
  if (response.status === 401 && useAuth && token && auth) {
    const next = await auth.refresh()
    if (next) {
      response = await send(path, options, next)
    } else {
      auth.onExpired()
    }
  }

  const data = await parseBody(response)

  if (!response.ok) {
    throw new ApiError(response.status, data)
  }

  return data as T
}

export const api = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'DELETE' }),
}
