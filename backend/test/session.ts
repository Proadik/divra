import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { freshIp } from './test-app.js';
import { type TestWallet, createTestWallet } from './wallet.js';

export const ORIGIN = 'http://localhost:5173';

export interface TestSession {
  wallet: TestWallet;
  userId: string;
  token: string;
}

/** Полный вход по подписи — как во фронтенде; возвращает access-токен */
export const signIn = async (
  app: INestApplication<App>,
  wallet?: TestWallet,
): Promise<TestSession> => {
  const signer = wallet ?? (await createTestWallet());
  const ip = freshIp();
  const post = (path: string) =>
    request(app.getHttpServer())
      .post(`/api${path}`)
      .set('X-Divra-Client', 'web')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip);
  const challenge = await post('/auth/wallet/challenge')
    .send({ chain: 'solana', address: signer.address })
    .expect(200);
  const verified = await post('/auth/wallet/verify')
    .send({
      challengeId: challenge.body.challengeId,
      chain: 'solana',
      address: signer.address,
      signedPayload: await signer.sign(challenge.body.transaction),
    })
    .expect(200);
  return {
    wallet: signer,
    userId: verified.body.user.id,
    token: verified.body.accessToken,
  };
};
