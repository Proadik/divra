import type { ReactElement } from 'react'
import { FeatureFlagsSync, QueryProvider, WalletSessionSync } from './state'
import { RouterProvider } from './router'

export const App = (): ReactElement => {
  return (
    <QueryProvider>
      <FeatureFlagsSync>
        <WalletSessionSync />
        <RouterProvider />
      </FeatureFlagsSync>
    </QueryProvider>
  )
}
