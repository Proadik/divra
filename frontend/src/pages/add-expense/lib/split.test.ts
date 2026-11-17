import { type SplitEntry, type SplitResult, computeSplit, distribute } from './split'
import { describe, expect, it } from 'vitest'

const people = (...values: number[]): SplitEntry[] =>
  values.map((value, i) => ({ memberId: `m${i}`, value }))
const cents = (result: SplitResult): number[] | SplitResult =>
  result.ok ? result.shares.map((share) => share.cents) : result

describe('distribute', () => {
  it('сумма частей всегда равна целому', () => {
    const parts = distribute(10000, [1, 1, 1])
    expect(parts).toEqual([3334, 3333, 3333])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000)
  })
})

describe('computeSplit', () => {
  it('поровну', () => {
    expect(cents(computeSplit(12000, 'equal', people(0, 0, 0, 0)))).toEqual([
      3000, 3000, 3000, 3000,
    ])
  })

  it('точные суммы должны сойтись с итогом', () => {
    expect(cents(computeSplit(12000, 'exact', people(100, 20)))).toEqual([10000, 2000])
    expect(computeSplit(12000, 'exact', people(100, 10))).toEqual({
      ok: false,
      reason: 'exact-mismatch',
      remainder: 1000,
    })
  })

  it('проценты — ровно 100', () => {
    expect(cents(computeSplit(12000, 'percent', people(30, 70)))).toEqual([3600, 8400])
    expect(computeSplit(12000, 'percent', people(30, 60))).toMatchObject({
      reason: 'percent-mismatch',
      remainder: 1000,
    })
  })

  it('доли — пропорционально', () => {
    expect(cents(computeSplit(9000, 'shares', people(2, 1)))).toEqual([6000, 3000])
    expect(computeSplit(9000, 'shares', people(0, 0))).toMatchObject({ reason: 'no-shares' })
  })

  it('без суммы или участников — ошибка', () => {
    expect(computeSplit(0, 'equal', people(0))).toMatchObject({ reason: 'no-amount' })
    expect(computeSplit(100, 'equal', [])).toMatchObject({ reason: 'no-members' })
  })

  it('валюта без копеек: делит целыми единицами, остаток — первым', () => {
    // 120 000 ₸ на троих — ровно по 40 000
    expect(cents(computeSplit(12_000_000, 'equal', people(0, 0, 0), 100))).toEqual([
      4_000_000, 4_000_000, 4_000_000,
    ])
    // 100 000 ₸ на троих — 33 334 + 33 333 + 33 333, без копеек
    expect(cents(computeSplit(10_000_000, 'equal', people(0, 0, 0), 100))).toEqual([
      3_333_400, 3_333_300, 3_333_300,
    ])
    expect(cents(computeSplit(10_000_000, 'percent', people(33.33, 33.33, 33.34), 100))).toEqual([
      3_333_000, 3_333_000, 3_334_000,
    ])
  })

  it('сумма с копейками при шаге 100 делится по центу', () => {
    expect(cents(computeSplit(1001, 'equal', people(0, 0), 100))).toEqual([501, 500])
  })
})
