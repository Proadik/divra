import type { ReactElement } from 'react'
import { Button, IconButton } from '@/shared/ui'
import { useDisconnectWallet } from '../model/use-disconnect-wallet'

export type DisconnectButtonProps = {
  /** icon — круглая кнопка в шапке, text — текстовая ссылка-действие */
  variant?: 'icon' | 'text'
  label?: string
}

export const DisconnectButton = ({
  variant = 'icon',
  label = 'Отключить кошелёк',
}: DisconnectButtonProps): ReactElement => {
  const disconnect = useDisconnectWallet()
  const handleClick = (): void => {
    void disconnect()
  }
  return variant === 'icon' ? (
    <IconButton icon="close" label={label} onClick={handleClick} />
  ) : (
    <Button variant="ghost" onClick={handleClick}>
      {label}
    </Button>
  )
}
