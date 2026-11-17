import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { WalletChip, useWalletSession } from '@/entities/wallet'
import { ROUTES } from '@/shared/config'
import { getWalletAdapter } from '@/shared/lib/wallets'
import { IconButton, Logo } from '@/shared/ui'

export const HomeHeader = (): ReactElement => {
  const navigate = useNavigate()
  const account = useWalletSession((state) => state.account)
  const walletId = useWalletSession((state) => state.walletId)
  const icon = walletId ? getWalletAdapter(walletId)?.getIcon() : undefined

  return (
    <header className="home__header">
      <h1 className="home__brand">
        <Logo height={28} />
      </h1>
      <div className="home__actions">
        {account && <WalletChip account={account} icon={icon} />}
        <IconButton
          icon="sliders"
          label="Настройки"
          onClick={() => void navigate(ROUTES.settings)}
        />
      </div>
    </header>
  )
}
