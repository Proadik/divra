import { pluralize } from './plural'
import { describe, expect, it } from 'vitest'

const forms = { one: 'перевод', few: 'перевода', many: 'переводов' }

describe('pluralize', () => {
  it('склоняет по правилам русского языка', () => {
    expect(pluralize(1, forms)).toBe('1 перевод')
    expect(pluralize(3, forms)).toBe('3 перевода')
    expect(pluralize(7, forms)).toBe('7 переводов')
    expect(pluralize(21, forms)).toBe('21 перевод')
  })
})
