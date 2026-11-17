import type { ReactElement } from 'react'
import { WalletList } from '@/features/wallet-auth'
import { env } from '@/shared/config'
import { getPendingInvite } from '@/shared/lib/pending-invite'
import { Logo, StatusPill } from '@/shared/ui'
import './ConnectPage.css'

const CLUSTER_LABEL = env.SOLANA_CLUSTER === 'mainnet-beta' ? 'Mainnet' : env.SOLANA_CLUSTER

export const ConnectPage = (): ReactElement => {
  const hasInvite = getPendingInvite() !== null

  return (
    <main className="connect page-enter">
      <header className="connect__header">
        <Logo height={28} />
        <StatusPill status="live">Solana · {CLUSTER_LABEL}</StatusPill>
      </header>

      <section className="connect__hero" aria-labelledby="connect-title">
        <h1 id="connect-title" className="connect__title">
          Поделили и рассчитались
        </h1>
        <p className="connect__lead">
          Подключи кошелёк, чтобы делить расходы с друзьями и закрывать долги в USDC одной
          транзакцией.
        </p>
      </section>

      {hasInvite && (
        <p className="connect__invite" role="status">
          Тебя пригласили в группу. Подключи и подтверди кошелёк — после этого вернёшься к
          приглашению.
        </p>
      )}

      <WalletList />

      <p className="connect__note">
        Divra видит только адрес кошелька. Доступа к средствам нет — каждую транзакцию ты
        подписываешь сам.
      </p>
    </main>
  )
}
