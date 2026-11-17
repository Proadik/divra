import type { INestApplication } from '@nestjs/common';
import { findAssociatedTokenPda } from '@solana-program/token';
import {
  address,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { groupMembers, settlements } from '../src/database/schema/index.js';
import { type TestSession, signIn } from './session.js';
import {
  type FakePaymentLookup,
  type FakeTransactionSender,
  createTestApp,
  freshIp,
} from './test-app.js';

const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const raw = (dollars: number): bigint =>
  BigInt(Math.round(dollars * 100)) * 10_000n;

interface Member {
  id: string;
  name: string;
  isMe: boolean;
}

describe('Рассчитаться (e2e)', () => {
  let app: INestApplication<App>;
  let db: Awaited<ReturnType<typeof createTestApp>>['db'];
  let chain: FakePaymentLookup;
  let sender: FakeTransactionSender;
  let settler: Awaited<ReturnType<typeof createTestApp>>['settlements'];

  beforeAll(async () => {
    ({ app, db, chain, sender, settlements: settler } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    sender.failWith = null;
  });

  const as = (session: TestSession | null) => {
    const ip = freshIp();
    const server = app.getHttpServer();
    const auth = (test: request.Test) =>
      (session
        ? test.set('Authorization', `Bearer ${session.token}`)
        : test
      ).set('X-Forwarded-For', ip);
    return {
      get: (path: string) => auth(request(server).get(`/api${path}`)),
      post: (path: string) => auth(request(server).post(`/api${path}`)),
    };
  };

  const expense = (
    paidById: string,
    amount: number,
    shares: Array<[string, number]>,
  ) => ({
    title: 'Расход',
    category: 'food',
    paidById,
    amount,
    splitMode: 'exact',
    shares: shares.map(([memberId, value]) => ({ memberId, amount: value })),
  });

  /** Я должен Другу 30 и Второму 20, Анне (без кошелька) — 10 */
  const setup = async () => {
    const me = await signIn(app);
    const friend = await signIn(app);
    const second = await signIn(app);
    const { body: group } = await as(me)
      .post('/groups')
      .send({ name: 'Поездка', kind: 'trip' })
      .expect(201);
    const groupId = group.id as string;
    for (const [session, name] of [
      [friend, 'Друг'],
      [second, 'Второй'],
    ] as const) {
      await db.insert(groupMembers).values({
        groupId,
        userId: session.userId,
        displayName: name,
        joinedAt: new Date(),
      });
    }
    await as(me)
      .post(`/groups/${groupId}/members`)
      .send({ displayName: 'Анна' })
      .expect(201);
    const members = (
      await as(me).get(`/groups/${groupId}/overview`).expect(200)
    ).body.members as Member[];
    const id = (name: string) =>
      members.find((member) => member.name === name)?.id ?? '';
    const ids = {
      me: members.find((member) => member.isMe)?.id ?? '',
      friend: id('Друг'),
      second: id('Второй'),
      anna: id('Анна'),
    };
    await as(friend)
      .post(`/groups/${groupId}/expenses`)
      .send(
        expense(ids.friend, 60, [
          [ids.me, 30],
          [ids.friend, 30],
        ]),
      )
      .expect(201);
    await as(second)
      .post(`/groups/${groupId}/expenses`)
      .send(
        expense(ids.second, 40, [
          [ids.me, 20],
          [ids.second, 20],
        ]),
      )
      .expect(201);
    await as(me)
      .post(`/groups/${groupId}/expenses`)
      .send(expense(ids.anna, 10, [[ids.me, 10]]))
      .expect(201);
    return { me, friend, second, groupId, ids };
  };

  type Ctx = Awaited<ReturnType<typeof setup>>;

  const prepare = (ctx: Ctx, transfers: Array<[string, number]>, patch = {}) =>
    as(ctx.me)
      .post(`/groups/${ctx.groupId}/settlements`)
      .send({
        token: 'USDC',
        payer: ctx.me.wallet.address,
        transfers: transfers.map(([memberId, amount]) => ({
          memberId,
          amount,
        })),
        ...patch,
      });

  /** Подписать кошельком и отправить. Подпись — до запроса: supertest нельзя вернуть из async */
  const submit = (ctx: Ctx, settlementId: string, signedTransaction: string) =>
    as(ctx.me)
      .post(`/groups/${ctx.groupId}/settlements/${settlementId}/submit`)
      .send({ settlementId, signedTransaction });

  const ata = async (owner: string) =>
    (
      await findAssociatedTokenPda({
        owner: address(owner),
        mint: address(DEVNET_USDC),
        tokenProgram: address(TOKEN_PROGRAM),
      })
    )[0];

  it('одна транзакция двум получателям: сверка в сети, долги погашены', async () => {
    const ctx = await setup();
    const { body: prepared } = await prepare(ctx, [
      [ctx.ids.friend, 30],
      [ctx.ids.second, 20],
    ]).expect(201);
    expect(prepared).toMatchObject({
      chain: 'solana',
      token: 'USDC',
      total: 50,
      transfers: [
        {
          memberId: ctx.ids.friend,
          name: 'Друг',
          address: ctx.friend.wallet.address,
          amount: 30,
        },
        {
          memberId: ctx.ids.second,
          name: 'Второй',
          address: ctx.second.wallet.address,
          amount: 20,
        },
      ],
    });

    const tx = getTransactionDecoder().decode(
      Buffer.from(prepared.transaction, 'base64'),
    );
    const message = getCompiledTransactionMessageDecoder().decode(
      tx.messageBytes,
    );
    expect(message.staticAccounts[0]).toBe(ctx.me.wallet.address);
    expect(Object.keys(tx.signatures)).toEqual([ctx.me.wallet.address]);
    expect(message.staticAccounts).toEqual(
      expect.arrayContaining([
        await ata(ctx.friend.wallet.address),
        await ata(ctx.second.wallet.address),
      ]),
    );

    chain.received.set(
      sender.peekNext(),
      new Map([
        [ctx.friend.wallet.address, raw(30)],
        [ctx.second.wallet.address, raw(20)],
        [ctx.me.wallet.address, -raw(50)],
      ]),
    );
    const { body: result } = await submit(
      ctx,
      prepared.settlementId,
      await ctx.me.wallet.sign(prepared.transaction),
    ).expect(200);
    expect(result).toMatchObject({
      settlementId: prepared.settlementId,
      signature: expect.stringMatching(/^fake-signature-/),
      status: 'confirmed',
      total: 50,
    });
    expect(result.transfers).toHaveLength(2);

    const { body: mine } = await as(ctx.me)
      .get(`/groups/${ctx.groupId}/overview`)
      .expect(200);
    expect(mine.debts).toEqual([
      { fromId: ctx.ids.me, toId: ctx.ids.anna, amount: 10 },
    ]);
    const { body: theirs } = await as(ctx.friend)
      .get(`/groups/${ctx.groupId}/overview`)
      .expect(200);
    expect(theirs.myBalance).toBe(0);
    const { body: home } = await as(ctx.friend).get('/me/overview').expect(200);
    expect(home.activity[0]).toMatchObject({
      type: 'payment',
      actor: { isMe: false },
      counterpart: { isMe: true },
      myDelta: 30,
      signature: result.signature,
    });

    // Повторно ту же транзакцию не отправить
    await submit(
      ctx,
      prepared.settlementId,
      await ctx.me.wallet.sign(prepared.transaction),
    ).expect(409);
  });

  it('частичная оплата: остаток долга сохраняется', async () => {
    const ctx = await setup();
    const { body: prepared } = await prepare(ctx, [
      [ctx.ids.friend, 10],
    ]).expect(201);
    chain.received.set(
      sender.peekNext(),
      new Map([[ctx.friend.wallet.address, raw(10)]]),
    );
    await submit(
      ctx,
      prepared.settlementId,
      await ctx.me.wallet.sign(prepared.transaction),
    ).expect(200);
    const { body } = await as(ctx.me)
      .get(`/groups/${ctx.groupId}/overview`)
      .expect(200);
    expect(body.debts).toEqual(
      expect.arrayContaining([
        { fromId: ctx.ids.me, toId: ctx.ids.friend, amount: 20 },
      ]),
    );
  });

  it('нельзя: больше долга, без кошелька, себе, чужой кошелёк, USDT, дубли, чужая группа', async () => {
    const ctx = await setup();
    await prepare(ctx, [[ctx.ids.friend, 30.01]]).expect(409);
    await prepare(ctx, [[ctx.ids.anna, 10]]).expect(409);
    await prepare(ctx, [[ctx.ids.me, 1]]).expect(422);
    // Второй мне ничего не должен, а я ему — да; наоборот — нельзя
    await as(ctx.second)
      .post(`/groups/${ctx.groupId}/settlements`)
      .send({
        token: 'USDC',
        payer: ctx.second.wallet.address,
        transfers: [{ memberId: ctx.ids.me, amount: 1 }],
      })
      .expect(409);
    await prepare(ctx, [[ctx.ids.friend, 1]], {
      payer: ctx.friend.wallet.address,
    }).expect(422);
    await prepare(ctx, [[ctx.ids.friend, 1]], { token: 'USDT' }).expect(400);
    await prepare(ctx, [
      [ctx.ids.friend, 1],
      [ctx.ids.friend, 1],
    ]).expect(400);
    await prepare(ctx, [[ctx.ids.friend, 1.001]]).expect(400);
    await prepare(ctx, []).expect(400);

    const stranger = await signIn(app);
    await as(stranger)
      .post(`/groups/${ctx.groupId}/settlements`)
      .send({
        token: 'USDC',
        payer: stranger.wallet.address,
        transfers: [{ memberId: ctx.ids.friend, amount: 1 }],
      })
      .expect(404);
  });

  it('чужая или подменённая транзакция, чужой расчёт, истёкший расчёт', async () => {
    const ctx = await setup();
    const { body: a } = await prepare(ctx, [[ctx.ids.friend, 10]]).expect(201);
    const { body: b } = await prepare(ctx, [[ctx.ids.second, 10]]).expect(201);
    const sentBefore = sender.sent.length;

    // Транзакция другого расчёта под этим id
    await submit(
      ctx,
      a.settlementId,
      await ctx.me.wallet.sign(b.transaction),
    ).expect(400);
    // Чужой пользователь не отправит мой расчёт
    await as(ctx.friend)
      .post(`/groups/${ctx.groupId}/settlements/${a.settlementId}/submit`)
      .send({ settlementId: a.settlementId, signedTransaction: a.transaction })
      .expect(404);
    expect(sender.sent.length).toBe(sentBefore);

    await db
      .update(settlements)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(settlements.id, a.settlementId));
    await submit(
      ctx,
      a.settlementId,
      await ctx.me.wallet.sign(a.transaction),
    ).expect(410);
    expect(sender.sent.length).toBe(sentBefore);
  });

  it('сеть отклонила перевод — понятная ошибка, расчёт закрыт, долги на месте', async () => {
    const ctx = await setup();
    const { body: prepared } = await prepare(ctx, [
      [ctx.ids.friend, 30],
    ]).expect(201);
    const { UnprocessableEntityException } = await import('@nestjs/common');
    sender.failWith = new UnprocessableEntityException(
      'Не хватает стейблкоина на кошельке или SOL на комиссию',
    );
    const { body } = await submit(
      ctx,
      prepared.settlementId,
      await ctx.me.wallet.sign(prepared.transaction),
    ).expect(422);
    expect(body.message).toContain('Не хватает');
    sender.failWith = null;
    await submit(
      ctx,
      prepared.settlementId,
      await ctx.me.wallet.sign(prepared.transaction),
    ).expect(409);
    const { body: overview } = await as(ctx.me)
      .get(`/groups/${ctx.groupId}/overview`)
      .expect(200);
    expect(overview.myBalance).toBe(-60);
  });

  it('засчитываются только реально дошедшие переводы', async () => {
    const ctx = await setup();
    const { body: prepared } = await prepare(ctx, [
      [ctx.ids.friend, 30],
      [ctx.ids.second, 20],
    ]).expect(201);
    // В сети дошло только Другу, Второму — на цент меньше
    chain.received.set(
      sender.peekNext(),
      new Map([
        [ctx.friend.wallet.address, raw(30)],
        [ctx.second.wallet.address, raw(19.99)],
      ]),
    );
    const { body: result } = await submit(
      ctx,
      prepared.settlementId,
      await ctx.me.wallet.sign(prepared.transaction),
    ).expect(200);
    expect(
      result.transfers.map((t: { memberId: string }) => t.memberId),
    ).toEqual([ctx.ids.friend]);
    expect(result.total).toBe(30);
    const { body } = await as(ctx.me)
      .get(`/groups/${ctx.groupId}/overview`)
      .expect(200);
    expect(body.debts).toEqual(
      expect.arrayContaining([
        { fromId: ctx.ids.me, toId: ctx.ids.second, amount: 20 },
      ]),
    );
  });

  it('подтверждение задержалось — 503, потом фоновая сверка гасит долг', async () => {
    const ctx = await setup();
    const { body: prepared } = await prepare(ctx, [
      [ctx.ids.friend, 30],
    ]).expect(201);
    const signature = sender.peekNext();
    chain.confirmations.set(signature, 'pending');
    const { body } = await submit(
      ctx,
      prepared.settlementId,
      await ctx.me.wallet.sign(prepared.transaction),
    ).expect(503);
    expect(body.message).toContain('отправлен');

    chain.confirmations.set(signature, 'confirmed');
    chain.received.set(
      signature,
      new Map([[ctx.friend.wallet.address, raw(30)]]),
    );
    await db
      .update(settlements)
      .set({ submittedAt: new Date(Date.now() - 60_000) })
      .where(eq(settlements.id, prepared.settlementId));
    await settler.checkSubmitted();
    const { body: overview } = await as(ctx.me)
      .get(`/groups/${ctx.groupId}/overview`)
      .expect(200);
    expect(
      overview.debts.find(
        (debt: { toId: string }) => debt.toId === ctx.ids.friend,
      ),
    ).toBeUndefined();
  });

  it('балансы — только своего кошелька', async () => {
    const ctx = await setup();
    const { body } = await as(ctx.me)
      .get(`/wallets/${ctx.me.wallet.address}/balances`)
      .expect(200);
    expect(body).toEqual({ USDC: 100, USDT: 0 });
    await as(ctx.me)
      .get(`/wallets/${ctx.friend.wallet.address}/balances`)
      .expect(404);
    await as(null)
      .get(`/wallets/${ctx.me.wallet.address}/balances`)
      .expect(401);
  });
});
