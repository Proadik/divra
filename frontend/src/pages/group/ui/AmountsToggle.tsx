import type { ReactElement } from 'react'
import { type AmountsIn, type Money, usePreferences } from '@/entities/currency'
import { FIAT_SYMBOLS } from '@/shared/config'
import { SegmentedControl } from '@/shared/ui'

/** Переключатель: суммы группы в стейблкоине или в валюте пользователя */
export const AmountsToggle = ({ money }: { money: Money }): ReactElement => {
  const { stablecoin, inputCurrency, amountsIn, setAmountsIn } = usePreferences()
  const options: ReadonlyArray<{ value: AmountsIn; label: string }> = [
    { value: 'stablecoin', label: stablecoin },
    { value: 'fiat', label: `${inputCurrency} ${FIAT_SYMBOLS[inputCurrency]}` },
  ]

  return (
    <div className="group-page__amounts">
      <SegmentedControl
        label="Показывать суммы в"
        options={options}
        value={amountsIn}
        onChange={setAmountsIn}
      />
      {money.note && (
        <p className="group-page__amounts-note" role="status">
          {money.note}
        </p>
      )}
    </div>
  )
}
