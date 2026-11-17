import { isAddress } from '@solana/kit';
import { z } from 'zod';

const chain = z.literal('solana', {
  error: 'Пока поддерживается только Solana',
});
const solanaAddress = z
  .string()
  .min(32)
  .max(44)
  .refine((value) => isAddress(value), 'Некорректный адрес Solana');

export const challengeRequestSchema = z.strictObject({
  chain,
  address: solanaAddress,
});

export const verifyRequestSchema = z.strictObject({
  challengeId: z.uuid(),
  chain,
  address: solanaAddress,
  /** Подписанная транзакция, base64. Длиннее пакета Solana (1232 байт) не бывает */
  signedPayload: z.string().min(1).max(1700),
});

export type ChallengeRequest = z.infer<typeof challengeRequestSchema>;
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;
