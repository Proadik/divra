import type { ReactElement } from 'react'
import { useMoney } from '@/entities/currency'
import type { HomeOverview } from '@/shared/api'
import { BalanceCard } from '@/shared/ui'

const caption = (net: number): string => {
  if (net > 0) {
    return 'В твою пользу'
  }
  return net < 0 ? 'Ты должен больше, чем тебе' : 'Со всеми в расчёте'
}

export const TotalsCard = ({ data }: { data: HomeOverview }): ReactElement => {
  const money = useMoney()
  const net = (Math.round(data.owedToMe * 100) - Math.round(data.iOwe * 100)) / 100
  return (
    <BalanceCard
      label="Итого по всем группам"
      value={money.fromUsd(net)}
      animateValue
      caption={caption(net)}
      currency={money.symbol}
      fractionDigits={money.fractionDigits}
    >
      <div className="home__stat">
        <span className="home__stat-label">Тебе должны</span>
        <span className="home__stat-value home__stat-value--back">
          {money.format(money.fromUsd(data.owedToMe))} {money.symbol}
        </span>
      </div>
      <div className="home__stat">
        <span className="home__stat-label">Ты должен</span>
        <span className="home__stat-value home__stat-value--owe">
          {money.format(money.fromUsd(data.iOwe))} {money.symbol}
        </span>
      </div>
    </BalanceCard>
  )
}
