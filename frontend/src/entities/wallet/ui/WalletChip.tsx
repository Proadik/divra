import type { ReactElement } from 'react'
import { shortenAddress } from '@/shared/lib/format'
import type { WalletAccount } from '@/shared/lib/wallets'
import { Icon } from '@/shared/ui'
import './WalletChip.css'

export type WalletChipProps = {
  account: WalletAccount
  icon?: string
}

/** Компактная плашка подключённого кошелька: иконка расширения + сокращённый адрес. */
export const WalletChip = ({ account, icon }: WalletChipProps): ReactElement => {
  return (
    <span className="wallet-chip" title={account.address}>
      {icon ? (
        <img className="wallet-chip__icon" src={icon} alt="" width={24} height={24} />
      ) : (
        <span className="wallet-chip__icon wallet-chip__icon--fallback">
          <Icon name="wallet" size={16} />
        </span>
      )}
      <span className="wallet-chip__address">{shortenAddress(account.address)}</span>
    </span>
  )
}
