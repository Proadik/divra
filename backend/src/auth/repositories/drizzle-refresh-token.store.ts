import { Injectable } from '@nestjs/common';
import {
  AuthenticationStorage,
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from '@nestjs/authentication';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import {
  refreshTokenFamilyRevocations,
  refreshTokens,
} from '../../database/schema/index.js';

type Row = typeof refreshTokens.$inferSelect;

/**
 * Хранилище refresh-токенов для @nestjs/authentication на PostgreSQL.
 * Правила контракта (их проверяет authenticationStoreContract в тестах):
 * - пометка «использован» — одна условная запись, а не чтение+запись: так ловится кража;
 * - отзыв семейства действует и на токены, сохранённые после него;
 * - необязательные поля возвращаются как undefined, не null; время — от сервиса, не от базы.
 */
@Injectable()
export class DrizzleRefreshTokenStore implements RefreshTokenStore {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ refreshTokens: this });
  }

  async getRefreshToken(id: string): Promise<RefreshTokenRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, id));
    return row ? toRecord(row) : undefined;
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Хранилище ограничено: семейства с истёкшим абсолютным сроком больше не нужны
      await tx
        .delete(refreshTokens)
        .where(lt(refreshTokens.familyExpiresAt, record.createdAt));
      await tx.insert(refreshTokens).values({
        id: record.id,
        familyId: record.familyId,
        userId: record.userId,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        familyExpiresAt: record.familyExpiresAt,
        usedAt: record.usedAt ?? null,
        claims: record.claims ?? null,
      });
    });
  }

  async markRefreshTokenUsed(id: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(refreshTokens)
      .set({ usedAt: at })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.usedAt)))
      .returning({ id: refreshTokens.id });
    return rows.length === 1;
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    await this.db
      .insert(refreshTokenFamilyRevocations)
      .values({ familyId, revokedAt: new Date() })
      .onConflictDoNothing();
  }

  async isRefreshTokenFamilyRevoked(familyId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ familyId: refreshTokenFamilyRevocations.familyId })
      .from(refreshTokenFamilyRevocations)
      .where(eq(refreshTokenFamilyRevocations.familyId, familyId));
    return row !== undefined;
  }

  async revokeUserRefreshTokens(userId: string): Promise<void> {
    const families = this.db
      .selectDistinct({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId));
    await this.db
      .insert(refreshTokenFamilyRevocations)
      .select(
        this.db
          .selectDistinct({
            familyId: refreshTokens.familyId,
            revokedAt: sql<Date>`now()`.as('revoked_at'),
          })
          .from(refreshTokens)
          .where(inArray(refreshTokens.familyId, families)),
      )
      .onConflictDoNothing();
  }
}

const toRecord = (row: Row): RefreshTokenRecord => ({
  id: row.id,
  familyId: row.familyId,
  userId: row.userId,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  familyExpiresAt: row.familyExpiresAt,
  ...(row.usedAt ? { usedAt: row.usedAt } : {}),
  ...(row.claims ? { claims: row.claims } : {}),
});
