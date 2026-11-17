import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { findAssociatedTokenPda } from '@solana-program/token';
import {
  address,
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  groupMembers,
  paymentRequests,
  payments,
} from '../src/database/schema/index.js';
import { type TestSession, signIn } from './session.js';
import {
  type FakePaymentLookup,
  type FakeTransactionSender,
  ORIGIN_HEADERS,
  createTestApp,
  freshIp,
} from './test-app.js';

const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const fakeSignature = (): string =>
  getAddressDecoder().decode(randomBytes(32)) + 'sig';

interface Member {
  id: string;
  name: string;
  isMe: boolean;
}

describe('Запросы на оплату (e2e)', () => {
  let app: INestApplication<App>;
  let db: Awaited<ReturnType<typeof createTestApp>>['db'];
  let chain: FakePaymentLookup;
  let sender: FakeTransactionSender;
  let service: Awaited<ReturnType<typeof createTestApp>>['payments'];

  beforeAll(async () => {
    ({ app, db, chain, sender, payments: service } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    chain.transfers.clear();
    chain.failing = false;
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

  /** Я заплатил 90 за троих: друг (с кошельком) и Анна (без) должны мне по 30 */
  const setup = async () => {
    const me = await signIn(app);
    const friend = await signIn(app);
    const { body: group } = await as(me)
      .post('/groups')
      .send({ name: 'Поездка', kind: 'trip' })
      .expect(201);
    await db.insert(groupMembers).values({
      groupId: group.id,
      userId: friend.userId,
      displayName: 'Друг',
      joinedAt: new Date(),
    });
    await as(me)
      .post(`/groups/${group.id}/members`)
      .send({ displayName: 'Анна' })
      .expect(201);
    const { body } = await as(me)
      .get(`/groups/${group.id}/overview`)
      .expect(200);
    const members = body.members as Member[];
    const ids = {
      me: members.find((member) => member.isMe)?.id ?? '',
      friend: members.find((member) => member.name === 'Друг')?.id ?? '',
      anna: members.find((member) => member.name === 'Анна')?.id ?? '',
    };
    await as(me)
      .post(`/groups/${group.id}/expenses`)
      .send({
        title: 'Бензин',
        category: 'transport',
        paidById: ids.me,
        amount: 90,
        splitMode: 'equal',
        shares: [ids.me, ids.friend, ids.anna].map((memberId) => ({
          memberId,
          amount: 30,
        })),
      })
      .expect(201);
    return { me, friend, groupId: group.id as string, ids };
  };

  const requestBody = (
    me: TestSession,
    memberIds: string[],
    patch: object = {},
  ) => ({
    token: 'USDC',
    recipient: me.wallet.address,
    memberIds,
    message: '',
    remindInDays: null,
    ...patch,
  });

  const pay = (
    reference: string,
    cents: number,
    signature = fakeSignature(),
  ) => {
    chain.transfers.set(reference, [
      { signature, rawAmount: BigInt(cents) * 10_000n },
    ]);
    return signature;
  };

  const referenceOf = (solanaPayUrl: string): string =>
    new URL(solanaPayUrl.replace('solana:', 'solana://')).searchParams.get(
      'reference',
    ) ?? '';

  it('создаёт ссылки Solana Pay на полную сумму долга, сумму считает сервер', async () => {
    const { me, groupId, ids } = await setup();
    const { body } = await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(
        requestBody(me, [ids.friend, ids.anna], { message: ' За  бензин ' }),
      )
      .expect(201);

    expect(body).toHaveLength(2);
    const [friend, anna] = body;
    expect(friend).toMatchObject({
      memberId: ids.friend,
      memberName: 'Друг',
      amount: 30,
      token: 'USDC',
      url: `http://localhost:5173/r/${friend.code}`,
    });
    expect(friend.code).toMatch(/^[\w-]{22}$/);
    const url = new URL(friend.solanaPayUrl.replace('solana:', 'solana://'));
    expect(friend.solanaPayUrl.startsWith(`solana:${me.wallet.address}?`)).toBe(
      true,
    );
    expect(url.searchParams.get('amount')).toBe('30.00');
    expect(url.searchParams.get('spl-token')).toBe(DEVNET_USDC);
    expect(url.searchParams.get('message')).toBe('За бензин');
    expect(referenceOf(friend.solanaPayUrl)).not.toBe(
      referenceOf(anna.solanaPayUrl),
    );

    const history = await as(me)
      .get(`/groups/${groupId}/payment-requests`)
      .expect(200);
    expect(
      history.body.map((item: { memberId: string }) => item.memberId).sort(),
    ).toEqual([ids.friend, ids.anna].sort());
  });

  it('«Отправленные»: статусы, ссылки; другим участникам мои запросы не видны', async () => {
    const { me, friend, groupId, ids } = await setup();
    const { body: created } = await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(me, [ids.friend, ids.anna]))
      .expect(201);
    const [toFriend, toAnna] = created;
    pay(referenceOf(toFriend.solanaPayUrl), 3000);
    await service.checkDue(1000);
    await db
      .update(paymentRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(paymentRequests.code, toAnna.code));
    const list = async () =>
      (await as(me).get(`/groups/${groupId}/payment-requests`).expect(200))
        .body as Array<Record<string, unknown>>;
    const byCode = (items: Array<Record<string, unknown>>, code: string) =>
      items.find((item) => item.code === code);

    const before = await list();
    expect(before).toHaveLength(2);
    expect(byCode(before, toFriend.code)).toMatchObject({
      memberName: 'Друг',
      amount: 30,
      status: 'paid',
      paidAt: expect.any(String),
      signature: expect.any(String),
    });
    expect(byCode(before, toAnna.code)).toMatchObject({
      status: 'expired',
      signature: null,
    });

    // Новый запрос Анне заменяет истёкший: в списке только он
    const { body: again } = await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(me, [ids.anna]))
      .expect(201);
    const after = await list();
    expect(after.map((item) => item.code)).toEqual([
      again[0].code,
      toFriend.code,
    ]);
    expect(after[0]).toMatchObject({
      memberId: ids.anna,
      memberName: 'Анна',
      status: 'open',
      paidAt: null,
      signature: null,
      url: again[0].url,
      solanaPayUrl: again[0].solanaPayUrl,
    });

    const { body: theirs } = await as(friend)
      .get(`/groups/${groupId}/payment-requests`)
      .expect(200);
    expect(theirs).toEqual([]);
  });

  it('повторный запрос тому же должнику: та же сумма — тот же запрос, новая сумма — замена', async () => {
    const { me, groupId, ids } = await setup();
    const create = async () =>
      (
        await as(me)
          .post(`/groups/${groupId}/payment-requests`)
          .send(requestBody(me, [ids.friend]))
          .expect(201)
      ).body[0] as { code: string; amount: number; solanaPayUrl: string };

    const first = await create();
    const same = await create();
    expect(same.code).toBe(first.code);

    // Долг вырос: ещё расход на 30, из них другу 15
    await as(me)
      .post(`/groups/${groupId}/expenses`)
      .send({
        title: 'Кофе',
        category: 'food',
        paidById: ids.me,
        amount: 30,
        splitMode: 'equal',
        shares: [
          { memberId: ids.me, amount: 15 },
          { memberId: ids.friend, amount: 15 },
        ],
      })
      .expect(201);
    const bigger = await create();
    expect(bigger.code).not.toBe(first.code);
    expect(bigger.amount).toBe(45);

    const { body: sent } = await as(me)
      .get(`/groups/${groupId}/payment-requests`)
      .expect(200);
    expect(sent.map((item: { code: string }) => item.code)).toEqual([
      bigger.code,
    ]);

    // Старая ссылка больше не принимает оплату
    const { body: gone } = await as(null)
      .get(`/payment-requests/${first.code}`)
      .expect(410);
    expect(gone.message).toContain('заменён');

    // …но если перевод по ней всё же пришёл — он засчитан
    pay(referenceOf(first.solanaPayUrl), 3000);
    await service.checkDue(1000);
    const { body: withPaid } = await as(me)
      .get(`/groups/${groupId}/payment-requests`)
      .expect(200);
    expect(
      withPaid.find((item: { code: string }) => item.code === first.code)
        ?.status,
    ).toBe('paid');
  });

  it('нельзя: чужой кошелёк, должник без долга, USDT в devnet, дубли, чужая группа', async () => {
    const { me, friend, groupId, ids } = await setup();
    const stranger = await signIn(app);

    // Перенаправить долг на чужой кошелёк
    await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(
        requestBody(me, [ids.friend], { recipient: stranger.wallet.address }),
      )
      .expect(422);
    // Друг мне ничего не должен — ему у меня не запросить
    await as(friend)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(friend, [ids.me]))
      .expect(409);
    await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(me, [ids.friend], { token: 'USDT' }))
      .expect(400);
    await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(me, [ids.friend, ids.friend]))
      .expect(400);
    // Сумму клиент не задаёт
    await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send({ ...requestBody(me, [ids.friend]), amount: 1 })
      .expect(400);
    await as(stranger)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(stranger, [ids.friend]))
      .expect(404);
    await as(stranger).get(`/groups/${groupId}/payment-requests`).expect(404);
    await as(null).get(`/groups/${groupId}/payment-requests`).expect(401);
  });

  it('страница запроса открывается без входа; кривой и неизвестный код — 404', async () => {
    const { me, groupId, ids } = await setup();
    const { body } = await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(me, [ids.anna]))
      .expect(201);
    const code = body[0].code;

    const { body: preview, headers } = await as(null)
      .get(`/payment-requests/${code}`)
      .expect(200);
    expect(headers['cache-control']).toBe('no-store');
    expect(preview).toMatchObject({
      code,
      fromAddress: me.wallet.address,
      toName: 'Анна',
      groupName: 'Поездка',
      amount: 30,
      token: 'USDC',
      message: '',
      status: 'open',
      paidAt: null,
    });
    expect(preview.solanaPayUrl).toBe(body[0].solanaPayUrl);

    await as(null)
      .get(`/payment-requests/${'A'.repeat(22)}`)
      .expect(404);
    await as(null).get('/payment-requests/short').expect(404);
  });

  it('оплата находится по reference: долг гаснет, в ленте — перевод', async () => {
    const { me, friend, groupId, ids } = await setup();
    const { body } = await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(me, [ids.friend]))
      .expect(201);
    const signature = pay(referenceOf(body[0].solanaPayUrl), 3000);

    const { body: preview } = await as(null)
      .get(`/payment-requests/${body[0].code}`)
      .expect(200);
    expect(preview.status).toBe('paid');
    expect(preview.paidAt).toEqual(expect.any(String));
    expect(preview.signature).toBe(signature);
    expect(chain.queries.at(-1)).toMatchObject({
      recipient: me.wallet.address,
      mint: DEVNET_USDC,
    });

    const { body: mine } = await as(me)
      .get(`/groups/${groupId}/overview`)
      .expect(200);
    expect(mine.debts).toEqual([
      { fromId: ids.anna, toId: ids.me, amount: 30 },
    ]);
    expect(mine.myBalance).toBe(30);
    // Погашенная пара больше не считается в «переводов без зачёта»
    expect(mine.transfersBeforeSimplify).toBe(1);

    const { body: theirs } = await as(friend)
      .get(`/groups/${groupId}/overview`)
      .expect(200);
    expect(theirs.debts).toEqual([]);
    expect(theirs.myBalance).toBe(0);

    const { body: home } = await as(me).get('/me/overview').expect(200);
    expect(home.activity[0]).toMatchObject({
      type: 'payment',
      signature,
      actor: { name: 'Друг', isMe: false },
      counterpart: { isMe: true },
      myDelta: 30,
    });

    // Повторные проверки ничего не задваивают
    await as(null).get(`/payment-requests/${body[0].code}`).expect(200);
    await service.checkDue();
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(payments)
      .where(eq(payments.groupId, groupId));
    expect(count).toBe(1);
  });

  it('недоплата и сбой сети — запрос остаётся открытым', async () => {
    const { me, groupId, ids } = await setup();
    const { body } = await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(me, [ids.friend]))
      .expect(201);
    const code = body[0].code;
    pay(referenceOf(body[0].solanaPayUrl), 2999);
    expect(
      (await as(null).get(`/payment-requests/${code}`).expect(200)).body.status,
    ).toBe('open');

    chain.failing = true;
    await db
      .update(paymentRequests)
      .set({ lastCheckedAt: null })
      .where(eq(paymentRequests.code, code));
    expect(
      (await as(null).get(`/payment-requests/${code}`).expect(200)).body.status,
    ).toBe('open');
  });

  it('одна транзакция не гасит два запроса', async () => {
    const { me, groupId, ids } = await setup();
    const { body } = await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(me, [ids.friend, ids.anna]))
      .expect(201);
    const signature = pay(referenceOf(body[0].solanaPayUrl), 3000);
    pay(referenceOf(body[1].solanaPayUrl), 3000, signature);

    await service.checkDue();
    const statuses = await Promise.all(
      body.map(async (item: { code: string }) => {
        const { body: preview } = await as(null)
          .get(`/payment-requests/${item.code}`)
          .expect(200);
        return preview.status;
      }),
    );
    expect(statuses.sort()).toEqual(['open', 'paid']);
  });

  it('фоновая проверка находит оплату без открытой страницы', async () => {
    const { me, groupId, ids } = await setup();
    const { body } = await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(me, [ids.anna]))
      .expect(201);
    pay(referenceOf(body[0].solanaPayUrl), 3000);

    expect(await service.checkDue(1000)).toBeGreaterThanOrEqual(1);
    const { body: overview } = await as(me)
      .get(`/groups/${groupId}/overview`)
      .expect(200);
    expect(
      overview.debts.find(
        (debt: { fromId: string }) => debt.fromId === ids.anna,
      ),
    ).toBeUndefined();
  });

  it('истёкший неоплаченный запрос — 410', async () => {
    const { me, groupId, ids } = await setup();
    const { body } = await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send(requestBody(me, [ids.friend]))
      .expect(201);
    await db
      .update(paymentRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(paymentRequests.code, body[0].code));
    await as(null).get(`/payment-requests/${body[0].code}`).expect(410);
  });

  describe('оплата прямо со страницы (кошелёк в браузере)', () => {
    const browser = (path: string) =>
      request(app.getHttpServer())
        .post(`/api${path}`)
        .set(ORIGIN_HEADERS)
        .set('X-Forwarded-For', freshIp());

    const requestFor = async () => {
      const ctx = await setup();
      const { body } = await as(ctx.me)
        .post(`/groups/${ctx.groupId}/payment-requests`)
        .send(requestBody(ctx.me, [ctx.ids.friend]))
        .expect(201);
      return {
        ...ctx,
        code: body[0].code as string,
        url: body[0].solanaPayUrl as string,
      };
    };

    it('собирает transferChecked получателю с reference, плательщик — кошелёк друга', async () => {
      const { me, friend, code, url } = await requestFor();
      const { body } = await browser(`/payment-requests/${code}/transaction`)
        .send({ account: friend.wallet.address })
        .expect(200);
      expect(body.message).toContain('30.00 USDC');

      const tx = getTransactionDecoder().decode(
        Buffer.from(body.transaction, 'base64'),
      );
      const message = getCompiledTransactionMessageDecoder().decode(
        tx.messageBytes,
      );
      const [destination] = await findAssociatedTokenPda({
        owner: address(me.wallet.address),
        mint: address(DEVNET_USDC),
        tokenProgram: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      });
      expect(message.staticAccounts[0]).toBe(friend.wallet.address);
      expect(message.staticAccounts).toEqual(
        expect.arrayContaining([referenceOf(url), destination, DEVNET_USDC]),
      );
      // Подписант один — плательщик
      expect(Object.keys(tx.signatures)).toEqual([friend.wallet.address]);

      // Подписал и отправил — бэкенд передал в сеть ровно эту транзакцию
      const signed = await friend.wallet.sign(body.transaction);
      const { body: sent } = await browser(`/payment-requests/${code}/submit`)
        .send({ signedTransaction: signed })
        .expect(200);
      expect(sent.signature).toBe(`fake-signature-${sender.sent.length}`);
      expect(sender.sent.at(-1)).toBe(signed);
    });

    it('нельзя: без заголовка приложения, получателю самому себе, чужая транзакция, оплаченный запрос', async () => {
      const { me, friend, code, url } = await requestFor();
      await request(app.getHttpServer())
        .post(`/api/payment-requests/${code}/transaction`)
        .set('X-Forwarded-For', freshIp())
        .send({ account: friend.wallet.address })
        .expect(403);
      await browser(`/payment-requests/${code}/transaction`)
        .send({ account: me.wallet.address })
        .expect(422);
      await browser(`/payment-requests/${code}/transaction`)
        .send({ account: 'not-an-address' })
        .expect(400);

      // Транзакция для другого запроса не пройдёт как оплата этого
      const other = await requestFor();
      const { body: foreign } = await browser(
        `/payment-requests/${other.code}/transaction`,
      )
        .send({ account: friend.wallet.address })
        .expect(200);
      const sentBefore = sender.sent.length;
      await browser(`/payment-requests/${code}/submit`)
        .send({
          signedTransaction: await friend.wallet.sign(foreign.transaction),
        })
        .expect(400);
      await browser(`/payment-requests/${code}/submit`)
        .send({ signedTransaction: Buffer.from('мусор').toString('base64') })
        .expect(400);
      expect(sender.sent.length).toBe(sentBefore);

      pay(referenceOf(url), 3000);
      await service.checkDue(1000);
      await browser(`/payment-requests/${code}/transaction`)
        .send({ account: friend.wallet.address })
        .expect(409);
    });

    it('сеть отклонила перевод — понятная ошибка, запрос открыт', async () => {
      const { friend, code } = await requestFor();
      const { body } = await browser(`/payment-requests/${code}/transaction`)
        .send({ account: friend.wallet.address })
        .expect(200);
      const { UnprocessableEntityException } = await import('@nestjs/common');
      sender.failWith = new UnprocessableEntityException(
        'Не хватает стейблкоина на кошельке или SOL на комиссию',
      );
      const { body: error } = await browser(`/payment-requests/${code}/submit`)
        .send({ signedTransaction: await friend.wallet.sign(body.transaction) })
        .expect(422);
      expect(error.message).toContain('Не хватает');
      const { body: preview } = await as(null)
        .get(`/payment-requests/${code}`)
        .expect(200);
      expect(preview.status).toBe('open');
    });
  });
});
