import type { ReactElement } from 'react'
import { formatAmount } from '@/shared/lib/format'
import { Avatar, type TxStep, TxSteps, toneFor } from '@/shared/ui'
import type { Settle, SettlePhase } from '../model/use-settle'

const ORDER: SettlePhase[] = ['preparing', 'signing', 'sending']

const stepsFor = (phase: SettlePhase, walletName: string): TxStep[] => {
  const at = ORDER.indexOf(phase)
  const state = (index: number): TxStep['state'] =>
    index < at ? 'done' : index === at ? 'active' : 'todo'
  return [
    { label: 'Транзакция собирается', state: state(0) },
    {
      label: `Подтверди в ${walletName}`,
      state: state(1),
      hint: 'Проверь получателей и сумму в окне кошелька',
    },
    { label: 'Отправка в Solana', state: state(2), hint: 'Обычно несколько секунд' },
    { label: 'Долги закрыты', state: 'todo' },
  ]
}

export const SettleProgress = ({ settle }: { settle: Settle }): ReactElement => {
  const chosen = settle.rows.filter((row) => row.selected)
  return (
    <>
      <section className="settle__card">
        <div className="settle__avatars">
          {chosen.map((row) => (
            <Avatar
              key={row.member.id}
              initials={row.member.initials}
              tone={toneFor(row.member.name)}
            />
          ))}
        </div>
        <span className="settle__big">
          {formatAmount(settle.totalCents / 100)}
          <span className="settle__summary-cur">{settle.token}</span>
        </span>
        <span className="settle__muted">
          {chosen.map((row) => `${row.member.name} ${row.amountText}`).join(' · ')}
        </span>
      </section>
      <section className="settle__card settle__card--steps" aria-live="polite">
        <TxSteps steps={stepsFor(settle.phase, settle.walletName ?? 'кошельке')} />
      </section>
      <p className="settle__hint settle__hint--center">
        Не закрывай страницу, пока перевод не подтвердится
      </p>
    </>
  )
}
