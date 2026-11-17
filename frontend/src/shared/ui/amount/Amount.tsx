import type { ReactElement } from 'react'
import { cx } from '@/shared/lib/classnames'
import { amountSign, formatAmount } from '@/shared/lib/format'
import './amount.css'

export type AmountProps = {
  value: number
  /** false — скрыть валюту */
  currency?: string | false
  /** Баланс: «+» красится accent (тебе должны), «−» — owe (ты должен) */
  signed?: boolean
  tone?: 'accent' | 'owe' | 'ink'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** 0 — без копеек (тенге, рубли) */
  fractionDigits?: 0 | 2
  className?: string
}

const toneOf = (value: number, signed: boolean): NonNullable<AmountProps['tone']> => {
  if (!signed || value === 0) {
    return 'ink'
  }
  return value > 0 ? 'accent' : 'owe'
}

export const Amount = ({
  value,
  currency = 'USDC',
  signed = false,
  tone,
  size = 'md',
  fractionDigits = 2,
  className,
}: AmountProps): ReactElement => {
  return (
    <span
      className={cx(
        'sp-amount',
        `sp-amount--${size}`,
        `sp-tone--${tone ?? toneOf(value, signed)}`,
        className,
      )}
    >
      <span className="sp-amount__value">
        {amountSign(value, signed) + formatAmount(value, fractionDigits)}
      </span>
      {currency !== false && <span className="sp-amount__cur">{currency}</span>}
    </span>
  )
}
