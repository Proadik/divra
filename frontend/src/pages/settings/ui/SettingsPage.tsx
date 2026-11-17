import { useQuery } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { usePreferences } from '@/entities/currency'
import { WalletChip, useWalletSession } from '@/entities/wallet'
import { DisconnectButton } from '@/features/wallet-auth'
import { RATES_STALE_MS, authKeys, getMe, getRates, ratesKeys } from '@/shared/api'
import { ROUTES, STABLECOINS, env } from '@/shared/config'
import { flagsSource } from '@/shared/lib/feature-flags'
import { formatRelativeDay, shortenAddress } from '@/shared/lib/format'
import { getWalletAdapter } from '@/shared/lib/wallets'
import { IconButton, ListGroup, SegmentedControl } from '@/shared/ui'
import { CurrencyList } from './CurrencyList'
import { FeatureFlagsPanel } from './FeatureFlagsPanel'
import './SettingsPage.css'

const COIN_OPTIONS = STABLECOINS.map((code) => ({ value: code, label: code }))

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

export const SettingsPage = (): ReactElement => {
  const navigate = useNavigate()
  const { inputCurrency, stablecoin, setInputCurrency, setStablecoin } = usePreferences()
  const account = useWalletSession((state) => state.account)
  const walletId = useWalletSession((state) => state.walletId)
  const adapter = walletId ? getWalletAdapter(walletId) : undefined
  // Профиль с бэкенда по JWT: заодно видно, что токен работает
  const me = useQuery({ queryKey: authKeys.me(), queryFn: getMe, staleTime: 60_000 })
  const rates = useQuery({
    queryKey: ratesKeys.usd(),
    queryFn: getRates,
    staleTime: RATES_STALE_MS,
  })

  return (
    <main className="settings page-enter">
      <header className="settings__header">
        <IconButton
          icon="arrow-left"
          label="На главную"
          onClick={() => void navigate(ROUTES.home)}
        />
        <h1 className="settings__title">Настройки</h1>
        <span className="settings__spacer" aria-hidden />
      </header>

      <section className="settings__section" aria-labelledby="settings-currency">
        <div className="settings__heading-row">
          <h2 id="settings-currency" className="settings__heading">
            Валюта ввода
          </h2>
          {rates.data && (
            <span className="settings__note-inline">
              курсы на {timeFormat.format(new Date(rates.data.updatedAt))}
            </span>
          )}
        </div>
        <CurrencyList
          value={inputCurrency}
          onChange={setInputCurrency}
          rates={rates.data}
          ratesPending={rates.isPending}
          stablecoin={stablecoin}
        />
        {rates.isError && <p className="settings__hint">Не удалось загрузить курсы</p>}
        <p className="settings__hint">
          В ней по умолчанию вводишь сумму расхода. В группе расход сохранится в долларовом
          эквиваленте по текущему курсу — в форме валюту можно сменить для одного расхода.
        </p>
      </section>

      <section className="settings__section" aria-labelledby="settings-coin">
        <h2 id="settings-coin" className="settings__heading">
          Стейблкоин для расчётов
        </h2>
        <SegmentedControl
          label="Стейблкоин для расчётов"
          options={COIN_OPTIONS}
          value={stablecoin}
          onChange={setStablecoin}
        />
        <p className="settings__hint">
          Оба привязаны к доллару 1:1. В нём показываются балансы и отправляются переводы в Solana.
        </p>
      </section>

      {(env.IS_DEV || flagsSource.kind === 'local') && <FeatureFlagsPanel />}

      <ListGroup title="Кошелёк">
        {account && (
          <div className="settings__wallet">
            <WalletChip account={account} icon={adapter?.getIcon()} />
            <span className="settings__note">{adapter?.name}</span>
          </div>
        )}
        {me.data && (
          <div className="settings__account">
            <span className="settings__note">
              Аккаунт {shortenAddress(me.data.id)} · создан {formatRelativeDay(me.data.createdAt)}
            </span>
            <span className="settings__note">
              {me.data.wallets.length} {me.data.wallets.length === 1 ? 'кошелёк' : 'кошелька'}
            </span>
          </div>
        )}
        {me.isError && <p className="settings__note">Профиль не загрузился</p>}
        <div className="settings__disconnect">
          <DisconnectButton variant="text" />
        </div>
      </ListGroup>
    </main>
  )
}
