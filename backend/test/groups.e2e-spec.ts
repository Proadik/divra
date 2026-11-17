import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { groupMembers } from '../src/database/schema/index.js';
import { MAX_MEMBERS_PER_GROUP } from '../src/groups/repositories/groups.repository.js';
import { type TestSession, signIn } from './session.js';
import { createTestApp, freshIp } from './test-app.js';

describe('Группы (e2e)', () => {
  let app: INestApplication<App>;
  let db: Awaited<ReturnType<typeof createTestApp>>['db'];

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (session: TestSession | null) => {
    const ip = freshIp();
    const auth = (test: request.Test) =>
      (session
        ? test.set('Authorization', `Bearer ${session.token}`)
        : test
      ).set('X-Forwarded-For', ip);
    const server = app.getHttpServer();
    return {
      get: (path: string) => auth(request(server).get(`/api${path}`)),
      post: (path: string) => auth(request(server).post(`/api${path}`)),
    };
  };

  const createGroup = async (session: TestSession, name = 'Поездка') =>
    (await as(session).post('/groups').send({ name, kind: 'trip' }).expect(201))
      .body as { id: string; name: string; membersCount: number };

  it('новый пользователь: пустая главная', async () => {
    const me = await signIn(app);
    const { body } = await as(me).get('/me/overview').expect(200);
    expect(body).toEqual({
      currency: 'USDC',
      owedToMe: 0,
      iOwe: 0,
      groups: [],
      activity: [],
    });
  });

  it('создаёт группу: создатель — первый активный участник, группа на главной', async () => {
    const me = await signIn(app);
    const group = await createGroup(me, '  Алматы   →  Бурабай ');
    expect(group).toMatchObject({
      name: 'Алматы → Бурабай',
      kind: 'trip',
      membersCount: 1,
      myBalance: 0,
    });

    const home = await as(me).get('/me/overview').expect(200);
    expect(home.body.groups.map((item: { id: string }) => item.id)).toEqual([
      group.id,
    ]);

    const { body } = await as(me)
      .get(`/groups/${group.id}/overview`)
      .expect(200);
    expect(body).toMatchObject({
      id: group.id,
      currency: 'USDC',
      myBalance: 0,
      debts: [],
      expenses: [],
    });
    const short = `${me.wallet.address.slice(0, 4)}…${me.wallet.address.slice(-4)}`;
    expect(body.members).toEqual([
      {
        id: expect.any(String),
        name: short,
        initials: short.charAt(0).toUpperCase(),
        isMe: true,
        status: 'active',
        address: null,
      },
    ]);
  });

  it('без токена — 401', async () => {
    await as(null).get('/me/overview').expect(401);
    await as(null)
      .post('/groups')
      .send({ name: 'x', kind: 'trip' })
      .expect(401);
  });

  it.each([
    [{ name: '   ', kind: 'trip' }],
    [{ name: 'x'.repeat(41), kind: 'trip' }],
    [{ name: 'Поездка', kind: 'party' }],
    [{ name: 'Поездка' }],
    [{ name: 'Поездка', kind: 'trip', createdBy: randomUUID() }],
    [{ name: 'evil‮txt.exe', kind: 'trip' }],
    [{ name: 'a\u0000b', kind: 'trip' }],
  ])('невалидная группа %j — 400', async (body) => {
    const me = await signIn(app);
    await as(me).post('/groups').send(body).expect(400);
  });

  it('чужая группа неотличима от несуществующей: 404 и в чтении, и в записи', async () => {
    const owner = await signIn(app);
    const stranger = await signIn(app);
    const group = await createGroup(owner);

    const foreign = await as(stranger)
      .get(`/groups/${group.id}/overview`)
      .expect(404);
    const missing = await as(stranger)
      .get(`/groups/${randomUUID()}/overview`)
      .expect(404);
    const malformed = await as(stranger)
      .get('/groups/1%20or%201=1/overview')
      .expect(404);
    expect(foreign.body.message).toBe(missing.body.message);
    expect(malformed.body.message).toBe(missing.body.message);

    await as(stranger)
      .post(`/groups/${group.id}/members`)
      .send({ displayName: 'Мой человек' })
      .expect(404);
    const home = await as(stranger).get('/me/overview').expect(200);
    expect(home.body.groups).toEqual([]);

    const own = await as(owner).get(`/groups/${group.id}/overview`).expect(200);
    expect(own.body.members).toHaveLength(1);
  });

  it('участник по имени — pending, без адреса; имена в группе уникальны без учёта регистра', async () => {
    const me = await signIn(app);
    const group = await createGroup(me);

    const { body: anna } = await as(me)
      .post(`/groups/${group.id}/members`)
      .send({ displayName: ' Анна   Ли ' })
      .expect(201);
    expect(anna).toEqual({
      id: expect.any(String),
      name: 'Анна Ли',
      initials: 'АЛ',
      isMe: false,
      status: 'pending',
      address: null,
    });

    const duplicate = await as(me)
      .post(`/groups/${group.id}/members`)
      .send({ displayName: 'анна ли' })
      .expect(409);
    expect(duplicate.body.message).toContain('уже есть');

    await as(me)
      .post(`/groups/${group.id}/members`)
      .send({ displayName: '' })
      .expect(400);

    const home = await as(me).get('/me/overview').expect(200);
    expect(home.body.groups[0].membersCount).toBe(2);
  });

  it('одновременные добавления одного имени: ровно одно успешное', async () => {
    const me = await signIn(app);
    const group = await createGroup(me);
    const statuses = await Promise.all(
      Array.from({ length: 5 }, () =>
        as(me)
          .post(`/groups/${group.id}/members`)
          .send({ displayName: 'Ержан' })
          .then((response) => response.status),
      ),
    );
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);
  });

  it(`не больше ${MAX_MEMBERS_PER_GROUP} участников`, async () => {
    const me = await signIn(app);
    const group = await createGroup(me);
    await db.insert(groupMembers).values(
      Array.from({ length: MAX_MEMBERS_PER_GROUP - 1 }, (_, index) => ({
        groupId: group.id,
        displayName: `Друг ${index}`,
      })),
    );
    await as(me)
      .post(`/groups/${group.id}/members`)
      .send({ displayName: 'Лишний' })
      .expect(422);
  });

  it('активные участники видят адреса друг друга, свой — нет', async () => {
    const me = await signIn(app);
    const friend = await signIn(app);
    const group = await createGroup(me);
    await db.insert(groupMembers).values({
      groupId: group.id,
      userId: friend.userId,
      displayName: 'Друг',
      joinedAt: new Date(),
    });

    const mine = await as(me).get(`/groups/${group.id}/overview`).expect(200);
    const theirs = await as(friend)
      .get(`/groups/${group.id}/overview`)
      .expect(200);
    const byName = (members: Array<{ name: string }>, name: string) =>
      members.find((member) => member.name === name);

    expect(byName(mine.body.members, 'Друг')).toMatchObject({
      isMe: false,
      status: 'active',
      address: friend.wallet.address,
    });
    expect(byName(theirs.body.members, 'Друг')).toMatchObject({
      isMe: true,
      address: null,
    });
    expect(
      theirs.body.members.find((member: { isMe: boolean }) => !member.isMe)
        .address,
    ).toBe(me.wallet.address);
  });

  it('новые группы — сверху', async () => {
    const me = await signIn(app);
    const first = await createGroup(me, 'Первая');
    const second = await createGroup(me, 'Вторая');
    const { body } = await as(me).get('/me/overview').expect(200);
    expect(body.groups.map((item: { id: string }) => item.id)).toEqual([
      second.id,
      first.id,
    ]);
  });
});
