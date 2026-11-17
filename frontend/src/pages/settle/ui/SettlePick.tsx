import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { apiErrorMessage } from '@/shared/api'
import { STABLECOINS, type Stablecoin, membersPath } from '@/shared/config'
import { formatAmount, shortenAddress } from '@/shared/lib/format'
import { WalletError, walletErrorMessage } from '@/shared/lib/wallets'
import { Avatar, Button, Checkbox, Icon, SegmentedControl, toneFor } from '@/shared/ui'
import type { Settle } from '../model/use-settle'

/** Отказ в кошельке — его текст; ошибка бэкенда — его сообщение («больше долга», «не хватает SOL») */
const errorText = (error: Error | null): string =>
  error instanceof WalletError
    ? walletErrorMessage(error)
    : apiErrorMessage(error, 'Не получилось рассчитаться — попробуй ещё раз')

const COIN_OPTIONS = STABLECOINS.map((coin) => ({ value: coin, label: coin }))

export const SettlePick = ({
  settle,
  groupId,
  onSubmit,
}: {
  settle: Settle
  groupId: string
  onSubmit: () => void
}): ReactElement => {
  const navigate = useNavigate()
  const { rows, token } = settle

  return (
    <>
      <section className="settle__summary">
        <span className="settle__summary-label">Ты должен</span>
        <span className="settle__summary-value">
          {formatAmount(rows.reduce((sum, row) => sum + row.owedCents, 0) / 100)}
          <span className="settle__summary-cur">{token}</span>
        </span>
        <span className="settle__summary-hint">Выбери, кому и сколько перевести</span>
      </section>

      <section className="settle__section" aria-labelledby="settle-to">
        <div className="settle__heading">
          <h2 id="settle-to">Кому переводим</h2>
          <span>одна транзакция</span>
        </div>
        <div className="sp-listgroup">
          {rows.map((row) => {
            const { member } = row
            const label = `Перевести ${member.name}`
            if (!member.address) {
              return (
                <div key={member.id} className="sp-row settle__row settle__row--off">
                  <Checkbox checked={false} disabled aria-label={label} />
                  <Avatar initials={member.initials} tone={toneFor(member.name)} />
                  <span className="sp-row__body">
                    <span className="sp-row__title">
                      {member.name} · {formatAmount(row.owedCents / 100)}
                    </span>
                    <span className="sp-row__sub settle__warn">
                      без кошелька — перевести некуда
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    icon="link"
                    className="settle__link"
                    onClick={() => void navigate(membersPath(groupId))}
                  >
                    Ссылка
                  </Button>
                </div>
              )
            }
            return (
              <div key={member.id} className="sp-row settle__row">
                <Checkbox
                  checked={row.selected}
                  aria-label={label}
                  onChange={(event) => settle.toggle(member.id, event.currentTarget.checked)}
                />
                <Avatar initials={member.initials} tone={toneFor(member.name)} />
                <span className="sp-row__body">
                  <span className="sp-row__title">{member.name}</span>
                  <span className="sp-row__sub">кошелёк {shortenAddress(member.address)}</span>
                </span>
                <label
                  className={row.overpay ? 'settle__amount settle__amount--bad' : 'settle__amount'}
                >
                  <input
                    inputMode="decimal"
                    value={row.amountText}
                    disabled={!row.selected}
                    aria-label={`Сумма для ${member.name}`}
                    size={Math.max(4, row.amountText.length)}
                    onChange={(event) => settle.setAmount(member.id, event.currentTarget.value)}
                  />
                  <span>{token}</span>
                </label>
              </div>
            )
          })}
        </div>
      </section>

      <section className="settle__section" aria-labelledby="settle-from">
        <div className="settle__heading">
          <h2 id="settle-from">Платишь с</h2>
        </div>
        <div className="sp-listgroup settle__wallet">
          <SegmentedControl<Stablecoin>
            label="Стейблкоин"
            options={COIN_OPTIONS}
            value={token}
            onChange={settle.setToken}
          />
          <div className="settle__wallet-row">
            <span className="settle__wallet-icon">
              <Icon name="wallet" size={18} />
            </span>
            <span className="settle__wallet-name">
              {settle.walletName ?? 'Кошелёк'}
              {settle.account && ` · ${shortenAddress(settle.account.address)}`}
            </span>
            <span className="settle__wallet-balance">
              {settle.balance === undefined ? '…' : `${formatAmount(settle.balance)} ${token}`}
            </span>
          </div>
        </div>
        <p className="settle__hint">
          Все переводы уйдут одной транзакцией — подпишешь один раз. Комиссию сети платит
          отправитель.
        </p>
      </section>

      <div className="settle__footer page-enter-action">
        {(settle.problem ?? settle.error) && (
          <p className="settle__error" role="alert">
            {settle.problem ?? errorText(settle.error)}
          </p>
        )}
        <Button size="lg" block disabled={!settle.canSubmit} onClick={onSubmit}>
          {settle.selectedCount > 0
            ? `Подписать и отправить · ${formatAmount(settle.totalCents / 100)} ${token}`
            : 'Выбери, кому перевести'}
        </Button>
      </div>
    </>
  )
}
