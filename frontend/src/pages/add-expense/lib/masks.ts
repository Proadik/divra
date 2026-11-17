import type { MaskitoOptions } from '@maskito/core'
import { type MaskitoNumberParams, maskitoNumber, maskitoParseNumber } from '@maskito/kit'
import type { SplitMode } from '@/shared/api'

const MONEY: MaskitoNumberParams = {
  maximumFractionDigits: 2,
  thousandSeparator: ' ',
  decimalSeparator: '.',
  decimalPseudoSeparators: [',', 'б', 'ю'],
  min: 0,
  /** В тенге суммы в сотни раз больше долларовых; итог в долларах проверяет схема */
  max: 1_000_000_000,
}

const PERCENT: MaskitoNumberParams = { ...MONEY, max: 100 }

const SHARES: MaskitoNumberParams = {
  maximumFractionDigits: 0,
  thousandSeparator: '',
  min: 0,
  max: 99,
}

const PARAMS: Record<Exclude<SplitMode, 'equal'>, MaskitoNumberParams> = {
  exact: MONEY,
  percent: PERCENT,
  shares: SHARES,
}

/** Тенге и рубли — без копеек: в поле суммы и точных долей дробную часть не ввести */
const WHOLE_MONEY: MaskitoNumberParams = { ...MONEY, maximumFractionDigits: 0 }

/**
 * Маски создаются один раз: useMaskito пересоздаёт маску при смене объекта опций.
 * Ключ — знаков после запятой у валюты ввода (FIAT_DECIMALS).
 */
export const amountMasks: Record<0 | 2, MaskitoOptions> = {
  0: maskitoNumber(WHOLE_MONEY),
  2: maskitoNumber(MONEY),
}

const percentMask = maskitoNumber(PERCENT)
const sharesMask = maskitoNumber(SHARES)

export const splitMaskOf = (
  mode: Exclude<SplitMode, 'equal'>,
  fractionDigits: 0 | 2,
): MaskitoOptions => {
  if (mode === 'exact') {
    return amountMasks[fractionDigits]
  }
  return mode === 'percent' ? percentMask : sharesMask
}

const parse = (text: string, params: MaskitoNumberParams): number => {
  if (!text.trim()) {
    return 0
  }
  const value = maskitoParseNumber(text, params)
  return Number.isFinite(value) ? value : 0
}

export const parseAmount = (text: string): number => parse(text, MONEY)

export const parseSplitValue = (mode: Exclude<SplitMode, 'equal'>, text: string): number =>
  parse(text, PARAMS[mode])
