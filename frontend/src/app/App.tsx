import type { ReactElement } from 'react'
import { FeatureFlagsSync, QueryProvider, ServerEventsSync, WalletSessionSync } from './state'
import { RouterProvider } from './router'

export const App = (): ReactElement => {
  return (
    <QueryProvider>
      <FeatureFlagsSync>
        <WalletSessionSync />
        <ServerEventsSync />
        <RouterProvider />
      </FeatureFlagsSync>
    </QueryProvider>
  )
}
