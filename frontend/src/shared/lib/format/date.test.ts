import { formatRelativeDay } from './date'
import { describe, expect, it } from 'vitest'

describe('formatRelativeDay', () => {
  const now = new Date(2026, 10, 16, 21, 0)

  it('сегодня и вчера — словами', () => {
    expect(formatRelativeDay(new Date(2026, 10, 16, 1, 0).toISOString(), now)).toBe('сегодня')
    expect(formatRelativeDay(new Date(2026, 10, 15, 23, 59).toISOString(), now)).toBe('вчера')
  })

  it('раньше — датой', () => {
    expect(formatRelativeDay(new Date(2026, 10, 12, 12, 0).toISOString(), now)).toMatch(/12/)
  })
})
