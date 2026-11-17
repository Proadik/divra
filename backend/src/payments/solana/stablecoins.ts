import type { Stablecoin } from '../../database/schema/index.js';

type Cluster = 'devnet' | 'testnet' | 'mainnet-beta';

/**
 * Адреса токенов стейблкоинов в каждой сети. null — официального токена нет.
 * Совпадает с frontend/src/shared/config/stablecoins.ts.
 */
const MINTS: Record<Cluster, Record<Stablecoin, string | null>> = {
  'mainnet-beta': {
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  },
  devnet: { USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', USDT: null },
  testnet: { USDC: null, USDT: null },
};

export const stablecoinMint = (
  cluster: Cluster,
  coin: Stablecoin,
): string | null => MINTS[cluster][coin];

/** У USDC и USDT 6 знаков: 1 цент = 10 000 минимальных единиц */
export const RAW_UNITS_PER_CENT = 10_000n;
