import type { Stablecoin } from './currencies'
import { env } from './env'

/**
 * Адреса токенов (mint) стейблкоинов в каждой сети Solana.
 * null — в этой сети официального токена нет: переводить им нельзя.
 */
const MINTS: Record<typeof env.SOLANA_CLUSTER, Record<Stablecoin, string | null>> = {
  'mainnet-beta': {
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  },
  // Circle выпускает тестовый USDC в devnet; у Tether devnet-токена нет
  devnet: { USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', USDT: null },
  testnet: { USDC: null, USDT: null },
}

export const stablecoinMint = (coin: Stablecoin): string | null => MINTS[env.SOLANA_CLUSTER][coin]

/** Ссылка на транзакцию в обозревателе с учётом сети */
export const explorerTxUrl = (signature: string): string =>
  env.SOLANA_CLUSTER === 'mainnet-beta'
    ? `https://solscan.io/tx/${signature}`
    : `https://solscan.io/tx/${signature}?cluster=${env.SOLANA_CLUSTER}`
