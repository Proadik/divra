import { BadRequestException, Injectable } from '@nestjs/common';
import type { Stablecoin } from '../database/schema/index.js';
import { HistoryRepository } from './history.repository.js';

/** Контракт — frontend/src/shared/api/history/schemas.ts */
export interface HistoryItemView {
  id: string;
  signature: string;
  token: Stablecoin;
  /** В долларах (стейблкоин 1:1) */
  amount: number;
  /** in — пришло тебе, out — ушло от тебя */
  direction: 'in' | 'out';
  /** Другая сторона: имя в общей группе, если есть, и адрес, если известен */
  counterparty: { name: string | null; address: string | null };
  /** Группа, где перевод засчитан в долг; null — не засчитан */
  countedIn: string | null;
  /** Перевод мимо Divra ждёт решения: засчитать или нет */
  suggested: boolean;
  createdAt: string;
}

export interface HistoryPageView {
  items: HistoryItemView[];
  /** Курсор следующей страницы; null — дальше ничего нет */
  nextCursor: string | null;
}

const encodeCursor = (at: string, id: string): string =>
  Buffer.from(`${at}|${id}`).toString('base64url');

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** Отметка времени Postgres (`created_at::text`): «2026-11-19 18:05:12.123456+00» */
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;

const decodeCursor = (cursor: string): { at: string; id: string } => {
  const [at = '', id = ''] = Buffer.from(cursor, 'base64url')
    .toString('utf8')
    .split('|');
  if (!UUID.test(id) || !TIMESTAMP.test(at)) {
    throw new BadRequestException('Некорректный курсор');
  }
  return { at, id };
};

/** «История»: переводы стейблкоина в сети с твоим участием */
@Injectable()
export class HistoryService {
  constructor(private readonly repository: HistoryRepository) {}

  async page(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<HistoryPageView> {
    // На одну запись больше — так видно, есть ли следующая страница
    const rows = await this.repository.page(
      userId,
      cursor ? decodeCursor(cursor) : null,
      limit + 1,
    );
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map((row) => ({
        id: row.id,
        signature: row.signature,
        token: row.token,
        amount: row.amountCents / 100,
        direction: row.direction,
        counterparty: {
          name: row.counterpartyName,
          address: row.counterpartyAddress,
        },
        countedIn: row.countedGroup,
        suggested: row.suggested,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor(last.cursorAt, last.id)
          : null,
    };
  }
}
