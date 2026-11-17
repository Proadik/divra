import type { WalletAdapter } from '../core/types'
import { phantom } from './phantom'
import { solflare } from './solflare'

export const solanaWallets: readonly WalletAdapter[] = [phantom, solflare]
