import type { ReactElement } from 'react'
import {
  type WalletAdapter,
  useWalletAdapters,
  walletAdapters,
  walletErrorMessage,
} from '@/shared/lib/wallets'
import { Icon, ListGroup, ListRow } from '@/shared/ui'
import { useConnectWallet } from '../model/use-connect-wallet'
import './WalletList.css'

const HINTS: Record<string, string> = {
  'solana:phantom': 'Расширение браузера',
  'solana:solflare': 'Расширение или приложение',
}

const WalletIcon = ({ adapter }: { adapter: WalletAdapter }): ReactElement => {
  const icon = adapter.getIcon()
  return icon ? (
    <img className="wallet-list__icon" src={icon} alt="" width={40} height={40} />
  ) : (
    <span className="wallet-list__tile">
      <Icon name="wallet" />
    </span>
  )
}

export const WalletList = (): ReactElement => {
  const adapters = useWalletAdapters(walletAdapters)
  const connect = useConnectWallet()
  const pendingId = connect.isPending ? connect.variables.id : null

  const handleSelect = (adapter: WalletAdapter): void => {
    if (connect.isPending) {
      return
    }
    if (!adapter.isInstalled()) {
      window.open(adapter.installUrl, '_blank', 'noopener,noreferrer')
      return
    }
    connect.mutate(adapter)
  }

  const statusOf = (adapter: WalletAdapter): ReactElement => {
    if (pendingId === adapter.id) {
      return <span className="wallet-list__status">Подтверди в кошельке…</span>
    }
    if (adapter.isInstalled()) {
      return <span className="wallet-list__status wallet-list__status--found">Найден</span>
    }
    return (
      <span className="wallet-list__status">
        Установить
        <Icon name="arrow-up-right" size={16} />
      </span>
    )
  }

  return (
    <div className="wallet-list">
      <ListGroup title="Выбери кошелёк">
        {adapters.map((adapter) => (
          <ListRow
            key={adapter.id}
            leading={<WalletIcon adapter={adapter} />}
            title={adapter.name}
            subtitle={HINTS[adapter.id]}
            trailing={statusOf(adapter)}
            onClick={() => handleSelect(adapter)}
          />
        ))}
      </ListGroup>
      {connect.isError && (
        <p className="wallet-list__error" role="alert">
          {walletErrorMessage(connect.error)}
        </p>
      )}
    </div>
  )
}
