import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { groupMembers } from '../src/database/schema/index.js';
import { type TestSession, signIn } from './session.js';
import { createTestApp, freshIp } from './test-app.js';

interface Member {
  id: string;
  name: string;
  isMe: boolean;
}

describe('Расходы и долги (e2e)', () => {
  let app: INestApplication<App>;
  let db: Awaited<ReturnType<typeof createTestApp>>['db'];

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
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
    };
  };

  /** Я, друг с кошельком и Анна без кошелька */
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
    return { me, friend, groupId: group.id as string, ids };
  };

  const expense = (
    paidById: string,
    amount: number,
    shares: Array<[string, number]>,
  ) => ({
    title: 'Бензин',
    category: 'transport',
    paidById,
    amount,
    splitMode: 'equal',
    shares: shares.map(([memberId, value]) => ({ memberId, amount: value })),
  });

  it('расход делит долги: баланс, кто кому, лента у обеих сторон', async () => {
    const { me, friend, groupId, ids } = await setup();

    const { body: created } = await as(me)
      .post(`/groups/${groupId}/expenses`)
      .send(
        expense(ids.me, 90, [
          [ids.me, 30],
          [ids.friend, 30],
          [ids.anna, 30],
        ]),
      )
      .expect(201);
    expect(created).toMatchObject({
      title: 'Бензин',
      paidById: ids.me,
      amount: 90,
      myShare: 30,
      original: null,
    });

    const mine = (await as(me).get(`/groups/${groupId}/overview`).expect(200))
      .body;
    expect(mine.myBalance).toBe(60);
    expect(mine.transfersBeforeSimplify).toBe(2);
    expect(mine.debts).toEqual(
      expect.arrayContaining([
        { fromId: ids.friend, toId: ids.me, amount: 30 },
        { fromId: ids.anna, toId: ids.me, amount: 30 },
      ]),
    );
    expect(mine.debts).toHaveLength(2);
    expect(mine.expenses).toHaveLength(1);

    const theirs = (
      await as(friend).get(`/groups/${groupId}/overview`).expect(200)
    ).body;
    expect(theirs.myBalance).toBe(-30);
    expect(theirs.debts).toEqual([
      { fromId: ids.friend, toId: ids.me, amount: 30 },
    ]);
    expect(theirs.expenses[0].myShare).toBe(30);

    const myHome = (await as(me).get('/me/overview').expect(200)).body;
    expect(myHome).toMatchObject({ owedToMe: 60, iOwe: 0 });
    expect(myHome.groups[0].myBalance).toBe(60);
    expect(myHome.activity[0]).toMatchObject({
      type: 'expense',
      groupId,
      title: 'Бензин',
      myDelta: 60,
      actor: { isMe: true },
      counterpart: null,
    });

    const friendHome = (await as(friend).get('/me/overview').expect(200)).body;
    expect(friendHome).toMatchObject({ owedToMe: 0, iOwe: 30 });
    expect(friendHome.activity[0]).toMatchObject({
      myDelta: -30,
      actor: { isMe: false },
    });
  });

  it('встречные долги зачитываются по парам', async () => {
    const { me, friend, groupId, ids } = await setup();
    await as(me)
      .post(`/groups/${groupId}/expenses`)
      .send(
        expense(ids.me, 60, [
          [ids.me, 30],
          [ids.friend, 30],
        ]),
      )
      .expect(201);
    await as(friend)
      .post(`/groups/${groupId}/expenses`)
      .send(expense(ids.friend, 20, [[ids.me, 20]]))
      .expect(201);

    const { body } = await as(me)
      .get(`/groups/${groupId}/overview`)
      .expect(200);
    expect(body.debts).toEqual([
      { fromId: ids.friend, toId: ids.me, amount: 10 },
    ]);
    expect(body.myBalance).toBe(10);
    expect(body.transfersBeforeSimplify).toBe(2);
    // Новые сверху
    expect(
      body.expenses.map((item: { amount: number }) => item.amount),
    ).toEqual([20, 60]);
  });

  it('копейки не теряются: 100 / 3 = 33.34 + 33.33 + 33.33', async () => {
    const { me, groupId, ids } = await setup();
    await as(me)
      .post(`/groups/${groupId}/expenses`)
      .send(
        expense(ids.me, 100, [
          [ids.me, 33.34],
          [ids.friend, 33.33],
          [ids.anna, 33.33],
        ]),
      )
      .expect(201);
    const { body } = await as(me)
      .get(`/groups/${groupId}/overview`)
      .expect(200);
    expect(body.myBalance).toBe(66.66);
  });

  it('расход за других без твоей доли не попадает в твою ленту', async () => {
    const { me, friend, groupId, ids } = await setup();
    await as(friend)
      .post(`/groups/${groupId}/expenses`)
      .send(expense(ids.friend, 10, [[ids.anna, 10]]))
      .expect(201);
    // Сам за себя — тоже не меняет баланс
    await as(me)
      .post(`/groups/${groupId}/expenses`)
      .send(expense(ids.me, 5, [[ids.me, 5]]))
      .expect(201);
    const { body } = await as(me).get('/me/overview').expect(200);
    expect(body.activity).toEqual([]);
    expect(body.groups[0].myBalance).toBe(0);
  });

  it('платить может и участник без кошелька', async () => {
    const { me, groupId, ids } = await setup();
    await as(me)
      .post(`/groups/${groupId}/expenses`)
      .send(expense(ids.anna, 40, [[ids.me, 40]]))
      .expect(201);
    const { body } = await as(me)
      .get(`/groups/${groupId}/overview`)
      .expect(200);
    expect(body.debts).toEqual([
      { fromId: ids.me, toId: ids.anna, amount: 40 },
    ]);
  });

  it('исходная валюта сохраняется, но сумма обязана сходиться с курсом', async () => {
    const { me, groupId, ids } = await setup();
    const body = (amount: number) => ({
      ...expense(ids.me, amount, [[ids.me, amount]]),
      original: { currency: 'KZT', amount: 5000, rate: 500 },
    });
    const { body: created } = await as(me)
      .post(`/groups/${groupId}/expenses`)
      .send(body(10))
      .expect(201);
    expect(created.original).toEqual({
      currency: 'KZT',
      amount: 5000,
      rate: 500,
    });

    await as(me)
      .post(`/groups/${groupId}/expenses`)
      .send(body(1000))
      .expect(400);
  });

  it.each([
    ['доли не сходятся с суммой', { amount: 10, shares: [{ amount: 9 }] }],
    ['больше двух знаков', { amount: 10.001, shares: [{ amount: 10.001 }] }],
    ['ноль', { amount: 0, shares: [{ amount: 0 }] }],
    [
      'отрицательная доля',
      { amount: 10, shares: [{ amount: 11 }, { amount: -1 }] },
    ],
    ['больше миллиона', { amount: 1_000_001, shares: [{ amount: 1_000_001 }] }],
    ['сумма строкой', { amount: '10', shares: [{ amount: 10 }] }],
    ['пустое название', { title: '  ', amount: 10, shares: [{ amount: 10 }] }],
    ['лишнее поле', { amount: 10, shares: [{ amount: 10 }], createdBy: 'x' }],
    [
      'неизвестная категория',
      { category: 'drugs', amount: 10, shares: [{ amount: 10 }] },
    ],
    ['пустые доли', { amount: 10, shares: [] }],
  ])('400: %s', async (_name, patch) => {
    const { me, groupId, ids } = await setup();
    const members = [ids.me, ids.friend];
    const { shares, ...rest } = patch as { shares: Array<{ amount: unknown }> };
    await as(me)
      .post(`/groups/${groupId}/expenses`)
      .send({
        ...expense(ids.me, 10, []),
        ...rest,
        shares: shares.map((share, index) => ({
          memberId: members[index],
          ...share,
        })),
      })
      .expect(400);
  });

  it('400: один участник дважды', async () => {
    const { me, groupId, ids } = await setup();
    await as(me)
      .post(`/groups/${groupId}/expenses`)
      .send(
        expense(ids.me, 10, [
          [ids.friend, 5],
          [ids.friend, 5],
        ]),
      )
      .expect(400);
  });

  it('участник из другой группы или выдуманный — 422, ничего не записано', async () => {
    const { me, groupId, ids } = await setup();
    const other = await setup();

    for (const body of [
      expense(ids.me, 10, [[other.ids.me, 10]]),
      expense(other.ids.me, 10, [[ids.me, 10]]),
      expense(ids.me, 10, [[randomUUID(), 10]]),
    ]) {
      await as(me).post(`/groups/${groupId}/expenses`).send(body).expect(422);
    }
    const { body } = await as(me)
      .get(`/groups/${groupId}/overview`)
      .expect(200);
    expect(body.expenses).toEqual([]);
  });

  it('в чужую группу записать нельзя — 404', async () => {
    const { groupId, ids } = await setup();
    const stranger = await signIn(app);
    await as(stranger)
      .post(`/groups/${groupId}/expenses`)
      .send(expense(ids.me, 10, [[ids.me, 10]]))
      .expect(404);
  });
});
