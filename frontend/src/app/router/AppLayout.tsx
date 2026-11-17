import type { ReactElement } from 'react'
import { Outlet } from 'react-router'
import { WalletMismatchBanner } from '@/entities/wallet'

/** Общая обёртка страниц: плашка о расхождении кошелька видна на любом экране. */
export const AppLayout = (): ReactElement => {
  return (
    <>
      <WalletMismatchBanner />
      <Outlet />
    </>
  )
}
