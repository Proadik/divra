import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, count, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { authChallenges } from '../../database/schema/index.js';

export type NewChallenge = typeof authChallenges.$inferInsert;
export type Challenge = typeof authChallenges.$inferSelect;

/** Сколько живых вызовов может висеть на одном адресе: дальше — 429 */
export const MAX_PENDING_PER_ADDRESS = 5;
/** Отработанные вызовы держим час — для разбора инцидентов, потом удаляем */
const KEEP_EXPIRED_MS = 60 * 60_000;

@Injectable()
export class ChallengesRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async countPending(
    chain: string,
    address: string,
    now: Date,
  ): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(authChallenges)
      .where(
        and(
          eq(authChallenges.chain, chain),
          eq(authChallenges.address, address),
          isNull(authChallenges.usedAt),
          gt(authChallenges.expiresAt, now),
        ),
      );
    return row?.value ?? 0;
  }

  async create(challenge: NewChallenge, now: Date): Promise<Challenge> {
    // Заодно чистим старые: таблица не растёт
    await this.db
      .delete(authChallenges)
      .where(
        lt(authChallenges.expiresAt, new Date(now.getTime() - KEEP_EXPIRED_MS)),
      );
    const [row] = await this.db
      .insert(authChallenges)
      .values(challenge)
      .returning();
    if (!row) {
      throw new Error('Вызов не сохранён');
    }
    return row;
  }

  /**
   * Забирает вызов одной условной записью: из параллельных попыток с одним id
   * успешна ровно одна, повторно вызов не сработает никогда — даже после ошибки подписи.
   */
  async consume(id: string, now: Date): Promise<Challenge | undefined> {
    const [row] = await this.db
      .update(authChallenges)
      .set({ usedAt: now })
      .where(
        and(
          eq(authChallenges.id, id),
          isNull(authChallenges.usedAt),
          gt(authChallenges.expiresAt, now),
        ),
      )
      .returning();
    return row;
  }
}
