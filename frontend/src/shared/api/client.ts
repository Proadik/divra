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
}

const buildUrl = (path: string, params?: RequestOptions['params']): string => {
  const url = new URL(path, env.API_URL || window.location.origin)

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

export const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { body, params, headers, ...init } = options
  const isJson = body !== undefined && !(body instanceof FormData)

  const response = await fetch(buildUrl(path, params), {
    ...init,
    headers: {
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: isJson ? JSON.stringify(body) : (body as BodyInit | undefined),
  })

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
