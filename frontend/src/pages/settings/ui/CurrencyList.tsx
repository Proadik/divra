import type { ReactElement } from 'react'
import type { Rates } from '@/shared/api'
import { FIAT_CURRENCIES, FIAT_NAMES, FIAT_SYMBOLS, type FiatCurrency } from '@/shared/config'
import { cx } from '@/shared/lib/classnames'
import { formatAmount } from '@/shared/lib/format'
import { Icon } from '@/shared/ui'

type CurrencyListProps = {
  value: FiatCurrency
  onChange: (currency: FiatCurrency) => void
  rates: Rates | undefined
  /** Курсы ещё грузятся: показываем «…», а не «нет курса» */
  ratesPending: boolean
  stablecoin: string
}

/**
 * Выбор валюты ввода: список, а не сегменты, — валют может быть сколько угодно.
 * Нативные radio: стрелки, Tab и скринридеры работают без доп. кода.
 */
export const CurrencyList = ({
  value,
  onChange,
  rates,
  ratesPending,
  stablecoin,
}: CurrencyListProps): ReactElement => {
  const rateText = (code: FiatCurrency): string => {
    if (code === 'USD') {
      return `1 $ = 1 ${stablecoin}`
    }
    const rate = rates?.rates[code]
    if (ratesPending) {
      return '…'
    }
    return rate ? `${formatAmount(rate)} ${FIAT_SYMBOLS[code]} = 1 ${stablecoin}` : 'нет курса'
  }

  return (
    <fieldset className="sp-listgroup settings__currencies">
      <legend className="settings__sr-only">Валюта ввода</legend>
      {FIAT_CURRENCIES.map((code) => {
        const checked = code === value
        return (
          <label
            key={code}
            className={cx('sp-row', 'sp-row--action', 'settings__currency', checked && 'is-on')}
          >
            <input
              type="radio"
              name="input-currency"
              value={code}
              checked={checked}
              onChange={() => onChange(code)}
              className="settings__sr-only"
            />
            <span className="settings__symbol" aria-hidden>
              {FIAT_SYMBOLS[code]}
            </span>
            <span className="sp-row__body">
              <span className="sp-row__title">{FIAT_NAMES[code]}</span>
              <span className="sp-row__sub">{code}</span>
            </span>
            <span className="settings__rate">{rateText(code)}</span>
            <span className="settings__check" aria-hidden>
              {checked && <Icon name="check" size={18} />}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
