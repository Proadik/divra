import { localFlagsSource, writeLocalFlag } from './sources'
import { isFlagOn, parseFlagValues, useFeatureFlagsStore } from './store'
import { startFeatureFlagsSync } from './sync'
import { getHomeOverview, getRates } from '@/shared/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('feature flags', () => {
  beforeEach(() => {
    localStorage.clear()
    useFeatureFlagsStore.setState({ values: {}, loaded: false })
  })

  it('из ответа берёт только известные флаги с булевым значением', () => {
    expect(
      parseFlagValues({ 'mock.rates': false, 'mock.nope': true, 'mock.groups': 'yes' }),
    ).toEqual({
      'mock.rates': false,
    })
  })

  it('apply возвращает флаги, у которых поменялось итоговое значение', () => {
    const { apply } = useFeatureFlagsStore.getState()
    // Дефолт mock.* = false: по умолчанию данных нет
    expect(apply({ 'mock.rates': false })).toEqual([])
    expect(apply({ 'mock.rates': true })).toEqual(['mock.rates'])
    expect(isFlagOn('mock.rates')).toBe(true)
    // Запись пропала из базы — вернулся дефолт
    expect(apply({})).toEqual(['mock.rates'])
    expect(isFlagOn('mock.rates')).toBe(false)
  })

  it('изменение в локальной базе применяется сразу, без опроса', async () => {
    const onChange = vi.fn()
    const stop = startFeatureFlagsSync({ source: localFlagsSource, pollMs: 60_000, onChange })
    await vi.waitFor(() => expect(useFeatureFlagsStore.getState().loaded).toBe(true))

    writeLocalFlag('mock.groups', true)

    expect(onChange).toHaveBeenCalledWith(['mock.groups'])
    expect(isFlagOn('mock.groups')).toBe(true)
    stop()
  })

  it('мок читает флаг в момент запроса: без флага пусто, с флагом — демо-данные', async () => {
    expect((await getHomeOverview()).groups).toEqual([])
    expect((await getRates()).rates).toEqual({ USD: 1 })

    useFeatureFlagsStore.getState().apply({ 'mock.groups': true, 'mock.rates': true })

    expect((await getHomeOverview()).groups.map((group) => group.name)).toContain(
      'Алматы → Бурабай',
    )
    expect((await getRates()).rates.KZT).toBe(515.4)
  })
})
