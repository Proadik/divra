import { z } from 'zod'
import { chainIdSchema } from '@/shared/config'

const base64 = z.base64()

export const walletChallengeRequestSchema = z.object({
  chain: chainIdSchema,
  address: z.string().min(1),
})

/**
 * Что бэкенд просит подписать. Размечено по сети: у каждой сети свой формат
 * (Solana — сериализованная транзакция; ethereum/ton/tron добавятся своими вариантами).
 */
export const walletChallengeSchema = z.discriminatedUnion('chain', [
  z.object({
    chain: z.literal('solana'),
    challengeId: z.string().min(1),
    /** Неподписанная транзакция (wire format, base64). В сеть не отправляется. */
    transaction: base64,
    /** Текст memo — показываем пользователю, что именно он подписывает */
    message: z.string(),
    expiresAt: z.iso.datetime(),
  }),
])

export const walletVerifyRequestSchema = z.object({
  challengeId: z.string().min(1),
  chain: chainIdSchema,
  address: z.string().min(1),
  /** Подписанная транзакция (base64) */
  signedPayload: base64,
})

/** Ответ на обновление токена. Refresh-токена в теле нет — он в HttpOnly-cookie. */
export const accessTokenSchema = z.object({
  tokenType: z.literal('Bearer'),
  /** JWT. Держим только в памяти: localStorage доступен любому скрипту на странице */
  accessToken: z.string().min(1),
  /** Секунды до истечения */
  expiresIn: z.number().int().positive(),
})

/** Вход прошёл: токен + кто вошёл. created — аккаунт только что зарегистрирован */
export const walletSessionSchema = accessTokenSchema.extend({
  user: z.object({
    id: z.string().min(1),
    chain: chainIdSchema,
    address: z.string().min(1),
    created: z.boolean(),
  }),
})

export const userProfileSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().nullable(),
  /** Замечать переводы мимо Divra от участников общих групп */
  detectTransfers: z.boolean().default(true),
  createdAt: z.iso.datetime(),
  lastSignInAt: z.iso.datetime().nullable(),
  wallets: z.array(
    z.object({ chain: chainIdSchema, address: z.string(), createdAt: z.iso.datetime() }),
  ),
})

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Введи имя').max(32, 'Не длиннее 32 символов'),
    detectTransfers: z.boolean(),
  })
  .partial()

export type WalletChallengeRequest = z.infer<typeof walletChallengeRequestSchema>
export type WalletChallenge = z.infer<typeof walletChallengeSchema>
export type WalletVerifyRequest = z.infer<typeof walletVerifyRequestSchema>
export type WalletSession = z.infer<typeof walletSessionSchema>
export type AccessToken = z.infer<typeof accessTokenSchema>
export type UserProfile = z.infer<typeof userProfileSchema>
