import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import {
  groupMembers,
  paymentRequests,
  users,
  walletAccounts,
} from '../../database/schema/index.js';
import { freeName, isNameFrom, shortAddress } from '../../groups/initials.js';
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
      detectTransfers: user.detectTransfers,
      createdAt: user.createdAt.toISOString(),
      lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
      wallets: wallets.map((wallet) => ({
        chain: wallet.chain as Chain,
        address: wallet.address,
        createdAt: wallet.createdAt.toISOString(),
      })),
    };
  }

  async updateDisplayName(
    id: string,
    displayName: string,
  ): Promise<UserProfile | undefined> {
    const updated = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, id))
        .for('update');
      if (!user) {
        return false;
      }
      const wallets = await tx
        .select({ address: walletAccounts.address })
        .from(walletAccounts)
        .where(eq(walletAccounts.userId, id));
      // Имена по умолчанию: короткий адрес любого кошелька, прежнее имя профиля
      const defaults = [
        ...wallets.map((wallet) => shortAddress(wallet.address)),
        ...(user.displayName ? [user.displayName] : []),
        'Я',
        'Участник',
      ];
      await tx.update(users).set({ displayName }).where(eq(users.id, id));

      const memberships = await tx
        .select({
          id: groupMembers.id,
          groupId: groupMembers.groupId,
          displayName: groupMembers.displayName,
        })
        .from(groupMembers)
        .where(and(eq(groupMembers.userId, id), isNull(groupMembers.leftAt)));
      const toRename = memberships.filter(
        (member) =>
          member.displayName !== displayName &&
          defaults.some((base) => isNameFrom(member.displayName, base)),
      );
      if (toRename.length === 0) {
        return true;
      }
      const others = await tx
        .select({
          id: groupMembers.id,
          groupId: groupMembers.groupId,
          displayName: groupMembers.displayName,
        })
        .from(groupMembers)
        .where(
          and(
            inArray(
              groupMembers.groupId,
              toRename.map((member) => member.groupId),
            ),
            isNull(groupMembers.leftAt),
          ),
        )
        // Блокируем участников этих групп: имя не займут параллельно
        .for('update');
      for (const member of toRename) {
        const taken = new Set(
          others
            .filter(
              (other) =>
                other.groupId === member.groupId && other.id !== member.id,
            )
            .map((other) => other.displayName.toLowerCase()),
        );
        await tx
          .update(groupMembers)
          .set({ displayName: freeName(displayName, taken) })
          .where(eq(groupMembers.id, member.id));
      }
      return true;
    });
    return updated ? this.getProfile(id) : undefined;
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .for('update');
      if (!user) {
        return false;
      }
      const memberships = await tx
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(eq(groupMembers.userId, id));
      if (memberships.length > 0) {
        const now = new Date();
        // Кошелёк больше не связан с Divra: новые оплаты по его запросам не ждём
        await tx
          .update(paymentRequests)
          .set({ replacedAt: now, cancelledAt: now })
          .where(
            and(
              inArray(
                paymentRequests.requesterMemberId,
                memberships.map((member) => member.id),
              ),
              isNull(paymentRequests.paidAt),
              isNull(paymentRequests.replacedAt),
            ),
          );
      }
      // Кошельки удаляются каскадом, участники групп остаются без кошелька (user_id → null)
      await tx.delete(users).where(eq(users.id, id));
      return true;
    });
  }

  async setDetectTransfers(id: string, enabled: boolean): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({ detectTransfers: enabled })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return rows.length > 0;
  }
}
