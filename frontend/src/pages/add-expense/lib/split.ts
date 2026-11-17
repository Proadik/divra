import type { SplitMode } from '@/shared/api'

export type SplitEntry = {
  memberId: string
  /** exact — сумма в валюте ввода, percent — проценты, shares — доли; для equal не используется */
  value: number
}

type SplitSuccess = { ok: true; shares: Array<{ memberId: string; cents: number }> }

type SplitFailure = {
  ok: false
  reason: 'no-amount' | 'no-members' | 'exact-mismatch' | 'percent-mismatch' | 'no-shares'
  /** Сколько осталось распределить: центы для exact, сотые доли процента для percent */
  remainder?: number
}

export type SplitResult = SplitSuccess | SplitFailure

export const toCents = (value: number): number => Math.round(value * 100)

/**
 * Делит total центов пропорционально весам методом наибольших остатков:
 * сумма частей всегда равна total, «лишние» центы получают участники с большей
 * дробной частью, при равенстве — первые в списке. Результат детерминирован.
 */
export const distribute = (total: number, weights: readonly number[]): number[] => {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  if (weightSum <= 0) {
    return weights.map(() => 0)
  }
  const exact = weights.map((weight) => (total * weight) / weightSum)
  const parts = exact.map(Math.floor)
  let left = total - parts.reduce((sum, part) => sum + part, 0)
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const { index } of order) {
    if (left <= 0) {
      break
    }
    parts[index] = (parts[index] ?? 0) + 1
    left -= 1
  }
  return parts
}

/**
 * Считает доли участников в центах. entries — только отмеченные участники, в порядке списка.
 * step — шаг доли в центах: 100 для валют без копеек (тенге, рубли), тогда 120 000 на троих —
 * ровно по 40 000, а 100 000 — 33 334 + 33 333 + 33 333. Если сама сумма не кратна шагу
 * (ввели с копейками), делим по центу.
 */
export const computeSplit = (
  totalCents: number,
  mode: SplitMode,
  entries: readonly SplitEntry[],
  step = 1,
): SplitResult => {
  if (totalCents <= 0) {
    return { ok: false, reason: 'no-amount' }
  }
  if (entries.length === 0) {
    return { ok: false, reason: 'no-members' }
  }

  const unit = totalCents % step === 0 ? step : 1
  const share = (weights: readonly number[]): number[] =>
    distribute(totalCents / unit, weights).map((part) => part * unit)

  const withCents = (parts: number[]): SplitResult => ({
    ok: true,
    shares: entries.map((entry, index) => ({ memberId: entry.memberId, cents: parts[index] ?? 0 })),
  })

  switch (mode) {
    case 'equal':
      return withCents(share(entries.map(() => 1)))

    case 'exact': {
      const parts = entries.map((entry) => toCents(entry.value))
      const remainder = totalCents - parts.reduce((sum, part) => sum + part, 0)
      return remainder === 0 ? withCents(parts) : { ok: false, reason: 'exact-mismatch', remainder }
    }

    case 'percent': {
      const basisPoints = entries.map((entry) => toCents(entry.value))
      const remainder = 10_000 - basisPoints.reduce((sum, part) => sum + part, 0)
      return remainder === 0
        ? withCents(share(basisPoints))
        : { ok: false, reason: 'percent-mismatch', remainder }
    }

    case 'shares': {
      const weights = entries.map((entry) => entry.value)
      return weights.some((weight) => weight > 0)
        ? withCents(share(weights))
        : { ok: false, reason: 'no-shares' }
    }
  }
}
