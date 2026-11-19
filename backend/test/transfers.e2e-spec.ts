import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { address } from '@solana/kit';
import { eq } from 'drizzle-orm';
import { type Socket, io } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  chainStreamState,
  groupMembers,
  paymentRequests,
} from '../src/database/schema/index.js';
import { recipientTokenAccount } from '../src/payments/solana/payment-transaction.js';
import { type TestSession, ORIGIN, signIn } from './session.js';
import {
  type FakePaymentLookup,
  type FakeTransferStream,
  createTestApp,
  freshIp,
} from './test-app.js';

interface Member {
  id: string;
  name: string;
  isMe: boolean;
}

/** USDC в devnet — сеть тестов по умолчанию */
const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const units = (dollars: number): bigint => BigInt(Math.round(dollars * 1e6));

/** Переводы мимо Divra: поток → подсказка получателю → «Засчитать» */
describe('Переводы мимо Divra (e2e)', () => {
  let app: INestApplication<App>;
  let db: Awaited<ReturnType<typeof createTestApp>>['db'];
  let stream: FakeTransferStream;
  let chain: FakePaymentLookup;
  let watcher: Awaited<ReturnType<typeof createTestApp>>['watcher'];
  let port: number;
  let signatureSeq = 0;

  beforeAll(async () => {
    ({ app, db, stream, chain, watcher } = await createTestApp());
    await app.listen(0);
    const server = app.getHttpServer() as unknown as {
      address: () => AddressInfo;
    };
    port = server.address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (session: TestSession) => {
    const ip = freshIp();
    const server = app.getHttpServer();
    const auth = (test: request.Test) =>
      test
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Forwarded-For', ip);
    return {
      get: (path: string) => auth(request(server).get(`/api${path}`)),
      post: (path: string) => auth(request(server).post(`/api${path}`)),
      patch: (path: string) => auth(request(server).patch(`/api${path}`)),
    };
  };

  /** Я заплатил 60 за двоих: друг должен мне 30 */
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
    const { body } = await as(me)
      .get(`/groups/${group.id}/overview`)
      .expect(200);
    const members = body.members as Member[];
    const ids = {
      me: members.find((member) => member.isMe)?.id ?? '',
      friend: members.find((member) => member.name === 'Друг')?.id ?? '',
    };
    await as(me)
      .post(`/groups/${group.id}/expenses`)
      .send({
        title: 'Домик',
        category: 'housing',
        paidById: ids.me,
        amount: 60,
        splitMode: 'equal',
        shares: [
          { memberId: ids.me, amount: 30 },
          { memberId: ids.friend, amount: 30 },
        ],
      })
      .expect(201);
    return { me, friend, groupId: group.id as string, ids };
  };

  /** Перевод from → to на сумму dollars «пришёл» из потока */
  const transfer = async (
    from: TestSession,
    to: TestSession,
    dollars: number,
    extra: { accounts?: string[]; signature?: string } = {},
  ): Promise<string> => {
    signatureSeq += 1;
    const signature = extra.signature ?? `sig-${signatureSeq}`;
    await stream.emit({
      signature,
      slot: 1000 + signatureSeq,
      accounts: extra.accounts ?? [],
      changes: [
        { owner: from.wallet.address, mint: USDC, delta: -units(dollars) },
        { owner: to.wallet.address, mint: USDC, delta: units(dollars) },
      ],
    });
    // Для повторной сверки при «Засчитать»
    chain.received.set(
      signature,
      new Map([
        [from.wallet.address, -units(dollars)],
        [to.wallet.address, units(dollars)],
      ]),
    );
    return signature;
  };

  const ata = (owner: TestSession): Promise<string> =>
    recipientTokenAccount(address(owner.wallet.address), address(USDC));

  it('подписка — на токен-аккаунты участников с общей группой; выключил — пропал', async () => {
    const { me, friend } = await setup();
    const loner = await signIn(app);
    await as(loner)
      .post('/groups')
      .send({ name: 'Один', kind: 'other' })
      .expect(201);

    await watcher.refresh();
    expect(stream.watched).toEqual(
      expect.arrayContaining([await ata(me), await ata(friend)]),
    );
    expect(stream.watched).not.toContain(await ata(loner));

    const { body: profile } = await as(friend)
      .patch('/me')
      .send({ detectTransfers: false })
      .expect(200);
    expect(profile.detectTransfers).toBe(false);
    await watcher.refresh();
    expect(stream.watched).not.toContain(await ata(friend));
  });

  it('перевод должника замечен: подсказка у получателя, слот сохранён', async () => {
    const { me, friend, groupId } = await setup();
    await transfer(friend, me, 25);

    const { body: mine } = await as(me)
      .get('/me/detected-transfers')
      .expect(200);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      token: 'USDC',
      amount: 25,
      fromName: 'Друг',
      groups: [{ groupId, groupName: 'Поездка', owed: 30 }],
    });
    const { body: theirs } = await as(friend)
      .get('/me/detected-transfers')
      .expect(200);
    expect(theirs).toHaveLength(0);

    const [state] = await db
      .select()
      .from(chainStreamState)
      .where(eq(chainStreamState.name, 'transfers'));
    expect(state?.lastSlot).toBe(1000 + signatureSeq);
  });

  it('«Засчитать»: долг уменьшается, перевод в ленте с подписью, второй раз — 404', async () => {
    const { me, friend, groupId, ids } = await setup();
    const signature = await transfer(friend, me, 25);
    const [hint] = (await as(me).get('/me/detected-transfers')).body;

    const { body } = await as(me)
      .post(`/detected-transfers/${hint.id}/apply`)
      .send({ groupId })
      .expect(200);
    expect(body).toEqual({ groupId, amount: 25, remaining: 5 });

    const overview = (await as(me).get(`/groups/${groupId}/overview`)).body;
    expect(overview.debts).toEqual([
      { fromId: ids.friend, toId: ids.me, amount: 5 },
    ]);
    const home = (await as(friend).get('/me/overview')).body;
    expect(home.activity[0]).toMatchObject({
      type: 'payment',
      signature,
      myDelta: -25,
    });
    expect((await as(me).get('/me/detected-transfers')).body).toHaveLength(0);
    await as(me)
      .post(`/detected-transfers/${hint.id}/apply`)
      .send({ groupId })
      .expect(404);
  });

  it('перевод больше долга засчитывается до долга; открытый запрос закрывается как оплаченный', async () => {
    const { me, friend, groupId, ids } = await setup();
    const { body: requests } = await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send({
        token: 'USDC',
        recipient: me.wallet.address,
        memberIds: [ids.friend],
        message: '',
        remindInDays: null,
      })
      .expect(201);
    await transfer(friend, me, 40);
    const [hint] = (await as(me).get('/me/detected-transfers')).body;

    const { body } = await as(me)
      .post(`/detected-transfers/${hint.id}/apply`)
      .send({ groupId })
      .expect(200);
    expect(body).toEqual({ groupId, amount: 30, remaining: 0 });
    const { body: preview } = await request(app.getHttpServer())
      .get(`/api/payment-requests/${requests[0].code}`)
      .expect(200);
    expect(preview.status).toBe('paid');
  });

  it('не подсказываем: никто не должен, перевод по нашей ссылке, повтор той же транзакции', async () => {
    const { me, friend, groupId, ids } = await setup();
    // Я ничего не должен другу
    await transfer(me, friend, 10);
    expect((await as(friend).get('/me/detected-transfers')).body).toHaveLength(
      0,
    );

    // Перевод с reference запроса засчитает основной механизм
    const { body: requests } = await as(me)
      .post(`/groups/${groupId}/payment-requests`)
      .send({
        token: 'USDC',
        recipient: me.wallet.address,
        memberIds: [ids.friend],
        message: '',
        remindInDays: null,
      })
      .expect(201);
    const [row] = await db
      .select({ reference: paymentRequests.reference })
      .from(paymentRequests)
      .where(eq(paymentRequests.code, requests[0].code));
    await transfer(friend, me, 30, { accounts: [row?.reference ?? ''] });
    expect((await as(me).get('/me/detected-transfers')).body).toHaveLength(0);

    // Поток прислал одну транзакцию дважды — подсказка одна
    await transfer(friend, me, 5, { signature: 'dup' });
    await transfer(friend, me, 5, { signature: 'dup' });
    expect((await as(me).get('/me/detected-transfers')).body).toHaveLength(1);
  });

  it('«Это не за долг», сверка с сетью, чужая подсказка', async () => {
    const { me, friend, groupId } = await setup();
    const signature = await transfer(friend, me, 10);
    const [hint] = (await as(me).get('/me/detected-transfers')).body;

    // Сеть ещё не подтвердила
    chain.received.delete(signature);
    await as(me)
      .post(`/detected-transfers/${hint.id}/apply`)
      .send({ groupId })
      .expect(409);
    // В сети пришло меньше, чем в подсказке
    chain.received.set(
      signature,
      new Map([
        [friend.wallet.address, -units(1)],
        [me.wallet.address, units(1)],
      ]),
    );
    await as(me)
      .post(`/detected-transfers/${hint.id}/apply`)
      .send({ groupId })
      .expect(409);

    await as(friend).post(`/detected-transfers/${hint.id}/dismiss`).expect(404);
    await as(me).post(`/detected-transfers/${hint.id}/dismiss`).expect(204);
    expect((await as(me).get('/me/detected-transfers')).body).toHaveLength(0);
    await as(me).post('/detected-transfers/not-a-uuid/dismiss').expect(404);
  });

  it('выключил функцию — переводы на мой кошелёк не подсказываются', async () => {
    const { me, friend } = await setup();
    await as(me).patch('/me').send({ detectTransfers: false }).expect(200);
    await transfer(friend, me, 10);
    expect((await as(me).get('/me/detected-transfers')).body).toHaveLength(0);
    await as(me).patch('/me').send({}).expect(400);
  });

  describe('WebSocket', () => {
    const sockets: Socket[] = [];

    afterEach(() => {
      for (const socket of sockets.splice(0)) {
        socket.disconnect();
      }
    });

    const connect = (token: string | null, origin = ORIGIN): Socket => {
      const socket = io(`http://127.0.0.1:${port}`, {
        path: '/api/socket.io',
        transports: ['websocket'],
        extraHeaders: { Origin: origin },
        auth: token ? { token } : {},
        reconnection: false,
      });
      sockets.push(socket);
      return socket;
    };

    const next = <T>(socket: Socket, event: string): Promise<T> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Нет события ${event}`)),
          3000,
        );
        socket.once(event, (payload: T) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });

    it('с токеном: подсказка и изменения группы приходят событиями', async () => {
      const { me, friend, groupId, ids } = await setup();
      const socket = connect(me.token);
      await next(socket, 'ready');

      const detected = next<{ id: string }>(socket, 'transfer.detected');
      await transfer(friend, me, 3);
      const { id } = await detected;
      const [hint] = (await as(me).get('/me/detected-transfers')).body;
      expect(id).toBe(hint.id);

      const changed = next<{ groupId: string }>(socket, 'group.changed');
      await as(friend)
        .post(`/groups/${groupId}/expenses`)
        .send({
          title: 'Кофе',
          category: 'food',
          paidById: ids.friend,
          amount: 4,
          splitMode: 'equal',
          shares: [
            { memberId: ids.me, amount: 2 },
            { memberId: ids.friend, amount: 2 },
          ],
        })
        .expect(201);
      expect(await changed).toEqual({ groupId });
    });

    it('без токена или с чужим токеном — отказ; чужой Origin — соединения нет', async () => {
      const anonymous = connect(null);
      await next(anonymous, 'unauthorized');

      const forged = connect('not.a.jwt');
      await next(forged, 'unauthorized');

      const { me } = await setup();
      const foreign = connect(me.token, 'https://evil.example');
      const error = await next<Error>(foreign, 'connect_error');
      expect(error).toBeInstanceOf(Error);
    });

    it('чужие события не приходят', async () => {
      const first = await setup();
      const second = await setup();
      const socket = connect(second.me.token);
      await next(socket, 'ready');
      let received = false;
      socket.on('transfer.detected', () => {
        received = true;
      });
      await transfer(first.friend, first.me, 2);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(received).toBe(false);
    });
  });
});
