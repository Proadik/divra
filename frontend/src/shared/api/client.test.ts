import { ApiError, api } from './client'
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

    expect(url.pathname).toBe('/users')
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
})
