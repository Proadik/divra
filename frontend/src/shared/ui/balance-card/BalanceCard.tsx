import type { ReactElement, ReactNode } from 'react'
import { useCountUp } from '@/shared/lib/animation'
import { amountSign, formatAmount } from '@/shared/lib/format'
import { AvatarStack, type Person } from '../avatar'
import './balance-card.css'

export type BalanceCardProps = {
  value: number
  animateValue?: boolean
  label?: string
  /** «Тебе должны в этой группе» / «Ты должен в этой группе» / «Все в расчёте» */
  caption?: string
  currency?: string
  /** 0 — без копеек (тенге, рубли) */
  fractionDigits?: 0 | 2
  people?: Person[]
  /** Две кнопки: <Button> и <Button variant="inverse"> */
  children?: ReactNode
}

const AnimatedBalance = ({
  value,
  fractionDigits,
}: {
  value: number
  fractionDigits: 0 | 2
}): string => {
  const shown = useCountUp(value)
  return amountSign(shown, true) + formatAmount(shown, fractionDigits)
}

export const BalanceCard = ({
  value,
  animateValue = false,
  label = 'Твой баланс',
  caption,
  currency = 'USDC',
  fractionDigits = 2,
  people,
  children,
}: BalanceCardProps): ReactElement => {
  return (
    <section className="sp-balance">
      <div className="sp-balance__top">
        <span className="sp-balance__label">{label}</span>
        {people && <AvatarStack people={people} onInverse />}
      </div>
      <div className="sp-balance__amount">
        <span className="sp-balance__value">
          {animateValue ? (
            <AnimatedBalance value={value} fractionDigits={fractionDigits} />
          ) : (
            amountSign(value, true) + formatAmount(value, fractionDigits)
          )}
        </span>
        <span className="sp-balance__cur">{currency}</span>
      </div>
      {caption && <div className="sp-balance__caption">{caption}</div>}
      {children && <div className="sp-balance__actions">{children}</div>}
    </section>
  )
}
