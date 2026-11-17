const MINUS = '\u2212'
const THIN_SPACE = '\u2009'

/**
 * 1234.5 → «1 234.50»: узкий пробел тысяч, точка, два знака. Знак не добавляется.
 * fractionDigits = 0 — целыми (тенге, рубли): 40000.19 → «40 000».
 */
export const formatAmount = (value: number, fractionDigits: 0 | 2 = 2): string =>
  Math.abs(value)
    .toFixed(fractionDigits)
    .replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)

/** Без копеек, если их нет: 45000 → «45 000», 12.5 → «12.50». Для сумм в фиате. */
export const formatAmountShort = (value: number): string => formatAmount(value).replace(/\.00$/, '')

/** «−» для отрицательных; «+» для положительных, только если signed. */
export const amountSign = (value: number, signed = false): string => {
  if (value < 0) {
    return MINUS
  }
  return signed && value > 0 ? '+' : ''
}
