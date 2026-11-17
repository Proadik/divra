import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { users, walletAccounts } from '../../database/schema/index.js';
import { rethrowUniqueViolation } from '../../database/unique-violation.js';
import { UniqueViolationError } from '../../common/errors/unique-violation.error.js';
import type {
  AuthUser,
  Chain,
  UserProfile,
  WalletAccount,
} from '../user.interface.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class DrizzleUsersRepository extends UsersRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {
    super();
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id));
    return row;
  }

  async signInWithWallet(
    wallet: WalletAccount,
  ): Promise<{ user: AuthUser; created: boolean }> {
    try {
      return await this.db.transaction(async (tx) => {
        const now = new Date();
        const [existing] = await tx
          .update(walletAccounts)
          .set({ lastUsedAt: now })
          .where(
            and(
              eq(walletAccounts.chain, wallet.chain),
              eq(walletAccounts.address, wallet.address),
            ),
          )
          .returning({ userId: walletAccounts.userId });

        if (existing) {
          await tx
            .update(users)
            .set({ lastSignInAt: now })
            .where(eq(users.id, existing.userId));
          return { user: { id: existing.userId }, created: false };
        }

        const [user] = await tx
          .insert(users)
          .values({ lastSignInAt: now })
          .returning({ id: users.id });
        if (!user) {
          throw new Error('Пользователь не создан');
        }
        await rethrowUniqueViolation(
          tx.insert(walletAccounts).values({
            userId: user.id,
            chain: wallet.chain,
            address: wallet.address,
          }),
        );
        return { user, created: true };
      });
    } catch (error) {
      // Параллельный первый вход того же кошелька успел зарегистрировать его раньше:
      // наша транзакция откатилась (лишнего пользователя нет), повторяем — теперь это вход
      if (error instanceof UniqueViolationError) {
        return this.signInWithWallet(wallet);
      }
      throw error;
    }
  }

  async getProfile(id: string): Promise<UserProfile | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    if (!user) {
      return undefined;
    }
    const wallets = await this.db
      .select({
        chain: walletAccounts.chain,
        address: walletAccounts.address,
        createdAt: walletAccounts.createdAt,
      })
      .from(walletAccounts)
      .where(eq(walletAccounts.userId, id))
      .orderBy(walletAccounts.createdAt);
    return {
      id: user.id,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
      lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
      wallets: wallets.map((wallet) => ({
        chain: wallet.chain as Chain,
        address: wallet.address,
        createdAt: wallet.createdAt.toISOString(),
      })),
    };
  }
}
