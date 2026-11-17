import { ApiError, api, configureAuth } from './client'
import { describe, expect, it, vi } from 'vitest'

const mockFetch = (body: unknown, init: ResponseInit = {}): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    }),
  )

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

describe('api client', () => {
  it('возвращает распарсенный JSON', async () => {
    mockFetch({ id: 1 })

    await expect(api.get('/users/1')).resolves.toEqual({ id: 1 })
  })

  it('добавляет query-параметры и пропускает undefined', async () => {
    const fetchMock = mockFetch([])

    await api.get('/users', { params: { page: 2, search: undefined } })

    const url = new URL(fetchMock.mock.calls[0][0] as string)

    expect(url.pathname).toBe('/api/users')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.has('search')).toBe(false)
  })

  it('отправляет тело запроса как JSON', async () => {
    const fetchMock = mockFetch({ ok: true })

    await api.post('/users', { name: 'Adil' })

    const init = fetchMock.mock.calls[0][1] as RequestInit

    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ name: 'Adil' }))
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('бросает ApiError при неуспешном ответе', async () => {
    mockFetch({ message: 'Not found' }, { status: 404 })

    const error = await api.get('/missing').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, data: { message: 'Not found' } })
  })

  describe('авторизация', () => {
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })

    it('шлёт Bearer и заголовок приложения', async () => {
      configureAuth({ getToken: () => 'jwt-1', refresh: vi.fn(), onExpired: vi.fn() })
      const fetchMock = mockFetch({ ok: true })

      await api.get('/me')

      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer jwt-1',
        'X-Divra-Client': 'web',
      })
      configureAuth(null)
    })

    it('на 401 обновляет токен один раз и повторяет запрос', async () => {
      const refresh = vi.fn().mockResolvedValue('jwt-2')
      configureAuth({ getToken: () => 'jwt-1', refresh, onExpired: vi.fn() })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json({ message: 'expired' }, 401))
        .mockResolvedValueOnce(json({ id: 'u1' }))
      vi.stubGlobal('fetch', fetchMock)

      await expect(api.get('/me')).resolves.toEqual({ id: 'u1' })
      expect(refresh).toHaveBeenCalledOnce()
      expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer jwt-2',
      })
      configureAuth(null)
    })

    it('refresh не удался — сессия истекает, ошибка 401', async () => {
      const onExpired = vi.fn()
      configureAuth({
        getToken: () => 'jwt-1',
        refresh: vi.fn().mockResolvedValue(null),
        onExpired,
      })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ message: 'expired' }, 401)))

      await expect(api.get('/me')).rejects.toMatchObject({ status: 401 })
      expect(onExpired).toHaveBeenCalledOnce()
      configureAuth(null)
    })

    it('эндпоинты входа ходят без токена', async () => {
      configureAuth({ getToken: () => 'jwt-1', refresh: vi.fn(), onExpired: vi.fn() })
      const fetchMock = mockFetch({ ok: true })

      await api.post('/auth/refresh', undefined, { auth: false })

      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty(
        'Authorization',
      )
      configureAuth(null)
    })
  })
})
