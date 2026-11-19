import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { sql } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import { type Stablecoin, chainTransfers } from '../database/schema/index.js';

export interface NewChainTransfer {
  signature: string;
  slot: number;
  token: Stablecoin;
  mint: string;
  rawAmount: bigint;
  fromAddress: string;
  toAddress: string;
  fromUserId: string | null;
  toUserId: string | null;
}

export interface HistoryRecord {
  id: string;
  signature: string;
  token: Stablecoin;
  amountCents: number;
  direction: 'in' | 'out';
  counterpartyName: string | null;
  counterpartyAddress: string | null;
  /** Группа, где этот перевод засчитан в долг; null — не засчитан */
  countedGroup: string | null;
  /** Ждёт решения получателя (подсказка «засчитать?») */
  suggested: boolean;
  createdAt: Date;
  /** created_at с точностью Postgres — для курсора без потери микросекунд */
  cursorAt: string;
}

interface HistoryRow extends Record<string, unknown> {
  id: string;
  signature: string;
  token: Stablecoin;
  cents: number | string;
  direction: 'in' | 'out';
  counterparty_name: string | null;
  counterparty_address: string | null;
  counted_group: string | null;
  suggested: boolean;
  created_at: Date | string;
  cursor_at: string;
}

@Injectable()
export class HistoryRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  /** Записать переводы из потока; повтор той же транзакции ничего не меняет */
  async record(transfers: readonly NewChainTransfer[]): Promise<number> {
    if (transfers.length === 0) {
      return 0;
    }
    const rows = await this.db
      .insert(chainTransfers)
      .values([...transfers])
      .onConflictDoNothing()
      .returning({ id: chainTransfers.id });
    return rows.length;
  }

  /**
   * История переводов в сети с участием userId, новые сверху, курсором (created_at, id).
   * Источники: индекс потока (chain_transfers) и засчитанные оплаты в сети (payments onchain) —
   * второй нужен, когда потока нет или он был выключен; одна транзакция не показывается дважды.
   */
  async page(
    userId: string,
    cursor: { at: string; id: string } | null,
    limit: number,
  ): Promise<HistoryRecord[]> {
    const after = cursor
      ? sql`and (i.created_at, i.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
      : sql``;
    const result = await this.db.execute<HistoryRow>(sql`
      with mine as (
        select id as member_id, group_id from group_members where user_id = ${userId}
      ),
      chain as (
        select ct.id, ct.signature, ct.token, (ct.raw_amount / 10000)::int as cents, ct.created_at,
          case when ct.to_user_id = ${userId} then 'in' else 'out' end as direction,
          case when ct.to_user_id = ${userId} then ct.from_address else ct.to_address end
            as counterparty_address,
          case when ct.to_user_id = ${userId} then ct.from_user_id else ct.to_user_id end
            as counterparty_user_id,
          null::uuid as counterparty_member_id
        from chain_transfers ct
        where ct.to_user_id = ${userId} or ct.from_user_id = ${userId}
      ),
      paid as (
        select p.id, p.signature, p.token, p.amount_cents as cents, p.created_at,
          case when p.to_member_id in (select member_id from mine) then 'in' else 'out' end
            as direction,
          null::varchar as counterparty_address,
          null::uuid as counterparty_user_id,
          case when p.to_member_id in (select member_id from mine) then p.from_member_id
            else p.to_member_id end as counterparty_member_id
        from payments p
        where p.method = 'onchain'
          and (p.to_member_id in (select member_id from mine)
            or p.from_member_id in (select member_id from mine))
          and not exists (
            select 1 from chain_transfers ct
            where ct.signature = p.signature
              and (ct.to_user_id = ${userId} or ct.from_user_id = ${userId})
          )
      ),
      items as (select * from chain union all select * from paid)
      select i.id, i.signature, i.token, i.cents, i.direction, i.counterparty_address,
        i.created_at, i.created_at::text as cursor_at,
        coalesce(
          cm.display_name,
          (select gm.display_name from group_members gm
            join mine on mine.group_id = gm.group_id
            where gm.user_id = i.counterparty_user_id and gm.left_at is null
            order by gm.created_at limit 1)
        ) as counterparty_name,
        (select g.name from payments p2 join groups g on g.id = p2.group_id
          where p2.signature = i.signature
            and (p2.to_member_id in (select member_id from mine)
              or p2.from_member_id in (select member_id from mine))
          limit 1) as counted_group,
        exists (
          select 1 from detected_transfers d
          where d.signature = i.signature and d.to_user_id = ${userId} and d.status = 'pending'
        ) as suggested
      from items i
      left join group_members cm on cm.id = i.counterparty_member_id
      where true ${after}
      order by i.created_at desc, i.id desc
      limit ${limit}
    `);
    return result.rows.map((row) => ({
      id: row.id,
      signature: row.signature,
      token: row.token,
      amountCents: Number(row.cents),
      direction: row.direction,
      counterpartyName: row.counterparty_name,
      counterpartyAddress: row.counterparty_address,
      countedGroup: row.counted_group,
      suggested: Boolean(row.suggested),
      createdAt: new Date(row.created_at),
      cursorAt: row.cursor_at,
    }));
  }
}
