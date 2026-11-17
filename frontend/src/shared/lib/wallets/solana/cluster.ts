import type { IdentifierString } from '@wallet-standard/base'
import { env } from '@/shared/config'

/** Идентификатор сети в формате Wallet Standard: `solana:devnet`, `solana:mainnet` … */
export const SOLANA_CHAIN: IdentifierString =
  env.SOLANA_CLUSTER === 'mainnet-beta' ? 'solana:mainnet' : `solana:${env.SOLANA_CLUSTER}`
