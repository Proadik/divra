/** Ввод суммы: только цифры и одна точка (запятую превращаем в точку), до двух знаков после. */
export const sanitizeAmount = (text: string): string => {
  const normalized = text.replace(',', '.').replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = normalized.split('.')
  return rest.length > 0 ? `${whole}.${rest.join('').slice(0, 2)}` : whole
}

export const parseAmount = (text: string): number => {
  const value = Number.parseFloat(text)
  return Number.isFinite(value) ? value : 0
}

export const toCents = (value: number): number => Math.round(value * 100)
