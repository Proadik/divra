import { describe, expect, it } from 'vitest'
import type { ExpenseDetail, GroupMember } from '@/shared/api'
import { amountText, editValuesOf } from './edit-values'

const member = (id: string): GroupMember => ({
  id,
  name: id,
  initials: id.charAt(0).toUpperCase(),
  isMe: id === 'me',
  status: 'active',
  address: null,
})

const members = ['me', 'dana', 'timur'].map(member)

const expense = (patch: Partial<ExpenseDetail>): ExpenseDetail => ({
  id: 'e1',
  title: 'Ужин',
  category: 'food',
  paidById: 'me',
  amount: 90,
  myShare: 30,
  original: null,
  createdAt: '2026-11-17T10:00:00.000Z',
  canEdit: true,
  splitMode: 'equal',
  shares: [
    { memberId: 'me', amount: 30 },
    { memberId: 'dana', amount: 30 },
    { memberId: 'timur', amount: 30 },
  ],
  updatedAt: null,
  ...patch,
})

describe('amountText', () => {
  it('группирует тысячи и убирает лишние нули', () => {
    expect(amountText(120_000, 0)).toBe('120 000')
    expect(amountText(40.5, 2)).toBe('40.5')
    expect(amountText(12, 2)).toBe('12')
  })
})

describe('editValuesOf', () => {
  it('поровну в тенге: сумма и курс из расхода, участники — те, у кого есть доля', () => {
    const result = editValuesOf(
      expense({
        amount: 232.56,
        original: { currency: 'KZT', amount: 120_000, rate: 516 },
        shares: [
          { memberId: 'me', amount: 116.28 },
          { memberId: 'dana', amount: 116.28 },
          { memberId: 'timur', amount: 0 },
        ],
      }),
      members,
    )
    expect(result.currency).toBe('KZT')
    expect(result.rate).toBe(516)
    expect(result.values).toMatchObject({
      currency: 'KZT',
      amountText: '120 000',
      mode: 'equal',
      selected: ['me', 'dana'],
    })
  })

  it('проценты и доли открываются точными суммами, которые сходятся с итогом', () => {
    const result = editValuesOf(
      expense({
        amount: 100,
        splitMode: 'percent',
        shares: [
          { memberId: 'me', amount: 33.34 },
          { memberId: 'dana', amount: 33.33 },
          { memberId: 'timur', amount: 33.33 },
        ],
      }),
      members,
    )
    expect(result.values.mode).toBe('exact')
    expect(result.values.splitTexts).toEqual({ me: '33.34', dana: '33.33', timur: '33.33' })
  })

  it('в тенге точные доли — целыми тенге', () => {
    const result = editValuesOf(
      expense({
        amount: 19.38,
        splitMode: 'exact',
        original: { currency: 'KZT', amount: 10_000, rate: 516 },
        shares: [
          { memberId: 'me', amount: 6.46 },
          { memberId: 'dana', amount: 12.92 },
        ],
      }),
      members,
    )
    const texts = Object.values(result.values.splitTexts ?? {})
    expect(texts).toEqual(['3 333', '6 667'])
  })
})
