import { z } from 'zod'

/**
 * Сети, которые архитектура поддерживает. Адаптеры сейчас есть только для Solana,
 * остальные значения зарезервированы — см. docs/architecture/wallets.md.
 */
export const chainIdSchema = z.enum(['solana', 'ethereum', 'ton', 'tron'])

export type ChainId = z.infer<typeof chainIdSchema>

export const CHAIN_LABELS: Record<ChainId, string> = {
  solana: 'Solana',
  ethereum: 'Ethereum',
  ton: 'TON',
  tron: 'TRON',
}
