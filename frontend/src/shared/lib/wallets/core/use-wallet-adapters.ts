import { useSyncExternalStore } from 'react'
import type { WalletAdapter } from './types'

/**
 * Список адаптеров, который перерисовывается, когда расширение регистрируется
 * или меняет иконку. Снимок — строка «id:installed:icon», чтобы React видел изменения.
 */
export const useWalletAdapters = (adapters: readonly WalletAdapter[]): readonly WalletAdapter[] => {
  useSyncExternalStore(
    (onChange) => {
      const offs = adapters.map((adapter) => adapter.onAvailabilityChange(onChange))
      return () => offs.forEach((off) => off())
    },
    () => adapters.map((a) => `${a.id}:${a.isInstalled()}:${a.getIcon() ?? ''}`).join('|'),
    () => '',
  )
  return adapters
}
