import type { WalletAdapter } from './core/types'
import { solanaWallets } from './solana'

/** Все адаптеры приложения. Новая сеть = новый модуль рядом с solana/ и строка здесь. */
export const walletAdapters: readonly WalletAdapter[] = [...solanaWallets]

export const getWalletAdapter = (id: string): WalletAdapter | undefined =>
  walletAdapters.find((adapter) => adapter.id === id)

export { WalletError, toWalletError, walletErrorMessage, type WalletErrorCode } from './core/errors'
export type {
  SignRequest,
  SignResult,
  Unsubscribe,
  WalletAccount,
  WalletAdapter,
  WalletId,
} from './core/types'
export { useWalletAdapters } from './core/use-wallet-adapters'
