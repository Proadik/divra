import { amountSign, formatAmount } from './amount'
import { describe, expect, it } from 'vitest'

describe('formatAmount', () => {
  it('всегда два знака после точки', () => {
    expect(formatAmount(12.5)).toBe('12.50')
    expect(formatAmount(0)).toBe('0.00')
  })

  it('разделяет тысячи узким пробелом и отбрасывает знак', () => {
    expect(formatAmount(-1234567.891)).toBe('1\u2009234\u2009567.89')
  })
})

describe('amountSign', () => {
  it('минус для отрицательных, плюс только для signed', () => {
    expect(amountSign(-1)).toBe('\u2212')
    expect(amountSign(1)).toBe('')
    expect(amountSign(1, true)).toBe('+')
    expect(amountSign(0, true)).toBe('')
  })
})
