import { AuthenticationStorage } from '@nestjs/authentication';
import { authenticationStoreContract } from '@nestjs/authentication/testing';
import { DrizzleRefreshTokenStore } from '../src/auth/repositories/drizzle-refresh-token.store.js';
import type { Database } from '../src/database/database.module.js';
import { createTestDatabase } from './test-app.js';

/**
 * Контракт хранилища из @nestjs/authentication: атомарная пометка «использован»,
 * отзыв семейства для токенов, сохранённых позже, гонка параллельных refresh.
 */
describe('DrizzleRefreshTokenStore — контракт @nestjs/authentication', () => {
  const cases = authenticationStoreContract(
    async () => {
      const db = (await createTestDatabase()) as unknown as Database;
      return {
        refreshTokens: new DrizzleRefreshTokenStore(
          db,
          new AuthenticationStorage(),
        ),
      };
    },
    { contracts: ['refreshTokens'], concurrent: true },
  );

  for (const contractCase of cases) {
    it(contractCase.name, () => contractCase.run());
  }
});
