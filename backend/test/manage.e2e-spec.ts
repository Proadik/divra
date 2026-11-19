import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { groupMembers } from '../src/database/schema/index.js';
import { ORIGIN, type TestSession, signIn } from './session.js';
import { ORIGIN_HEADERS, createTestApp, freshIp } from './test-app.js';

interface Member {
  id: string;
  name: string;
  isMe: boolean;
  status: 'active' | 'pending';
}

/** Правка и удаление расходов, выход из группы, отзыв ссылок, напоминания, наличные, профиль */
describe('Управление группой и аккаунтом (e2e)', () => {
  let app: INestApplication<App>;
  let db: Awaited<ReturnType<typeof createTestApp>>['db'];

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (session?: TestSession) => {
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
      put: (path: string) => auth(request(server).put(`/api${path}`)),
      patch: (path: string) => auth(request(server).patch(`/api${path}`)),
      delete: (path: string) => auth(request(server).delete(`/api${path}`)),
    };
  };

  const expense = (
    paidById: string,
    amount: number,
    shares: Array<[string, number]>,
    title = 'Бензин',
  ) => ({
    title,
    category: 'transport',
    paidById,
    amount,
    splitMode: 'equal',
    shares: shares.map(([memberId, value]) => ({ memberId, amount: value })),
  });

  /** Я, друг с кошельком, третий с кошельком и Анна без кошелька. Без расходов */
  const setup = async () => {
    const me = await signIn(app);
    const friend = await signIn(app);
    const third = await signIn(app);
    const { body: group } = await as(me)
      .post('/groups')
      .send({ name: 'Поездка', kind: 'trip' })
      .expect(201);
    await db.insert(groupMembers).values([
      {
        groupId: group.id,
        userId: friend.userId,
        displayName: 'Друг',
        joinedAt: new Date(),
      },
      {
        groupId: group.id,
        userId: third.userId,
        displayName: 'Третий',
        joinedAt: new Date(),
      },
    ]);
    await as(me)
      .post(`/groups/${group.id}/members`)
      .send({ displayName: 'Анна' })
      .expect(201);
    const members = await membersOf(me, group.id);
    const id = (name: string) =>
      members.find((member) => member.name === name)?.id ?? '';
    const ids = {
      me: members.find((member) => member.isMe)?.id ?? '',
      friend: id('Друг'),
      third: id('Третий'),
      anna: id('Анна'),
    };
    return { me, friend, third, groupId: group.id as string, ids };
  };

  const membersOf = async (session: TestSession, groupId: string) =>
    (await as(session).get(`/groups/${groupId}/overview`).expect(200)).body
      .members as Member[];

  const overview = async (session: TestSession, groupId: string) =>
    (await as(session).get(`/groups/${groupId}/overview`).expect(200)).body;

  describe('расходы', () => {
    it('автор правит расход: доли заменяются, долги пересчитываются', async () => {
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
      expect(created.canEdit).toBe(true);

      const { body: detail } = await as(me)
        .get(`/groups/${groupId}/expenses/${created.id}`)
        .expect(200);
      expect(detail).toMatchObject({
        id: created.id,
        splitMode: 'equal',
        canEdit: true,
        updatedAt: null,
      });
      expect(detail.shares).toHaveLength(3);

      const { body: updated } = await as(me)
        .put(`/groups/${groupId}/expenses/${created.id}`)
        .send(
          expense(
            ids.me,
            40,
            [
              [ids.me, 20],
              [ids.friend, 20],
            ],
            'Такси',
          ),
        )
        .expect(200);
      expect(updated).toMatchObject({
        id: created.id,
        title: 'Такси',
        amount: 40,
        myShare: 20,
      });

      const mine = await overview(me, groupId);
      expect(mine.debts).toEqual([
        { fromId: ids.friend, toId: ids.me, amount: 20 },
      ]);
      expect(mine.expenses).toHaveLength(1);
      const after = (
        await as(me).get(`/groups/${groupId}/expenses/${created.id}`)
      ).body;
      expect(after.shares).toHaveLength(2);
      expect(after.updatedAt).not.toBeNull();

      // Друг не автор и не плательщик: видит, но не правит
      const theirs = await overview(friend, groupId);
      expect(theirs.expenses[0].canEdit).toBe(false);
    });

    it('плательщик тоже может править и удалять; остальные — 403', async () => {
      const { me, friend, third, groupId, ids } = await setup();
      // Я записал расход, но платил друг
      const { body: created } = await as(me)
        .post(`/groups/${groupId}/expenses`)
        .send(
          expense(ids.friend, 60, [
            [ids.friend, 30],
            [ids.third, 30],
          ]),
        )
        .expect(201);
      expect((await overview(friend, groupId)).expenses[0].canEdit).toBe(true);
      expect((await overview(third, groupId)).expenses[0].canEdit).toBe(false);

      await as(third)
        .put(`/groups/${groupId}/expenses/${created.id}`)
        .send(expense(ids.third, 60, [[ids.third, 60]]))
        .expect(403);
      await as(third)
        .delete(`/groups/${groupId}/expenses/${created.id}`)
        .expect(403);

      await as(friend)
        .delete(`/groups/${groupId}/expenses/${created.id}`)
        .expect(204);
      const after = await overview(third, groupId);
      expect(after.expenses).toHaveLength(0);
      expect(after.debts).toHaveLength(0);
      await as(friend)
        .delete(`/groups/${groupId}/expenses/${created.id}`)
        .expect(404);
    });

    it('чужая группа — 404; кривой id расхода — 404; доля участника другой группы — 422', async () => {
      const { me, groupId, ids } = await setup();
      const stranger = await signIn(app);
      const { body: created } = await as(me)
        .post(`/groups/${groupId}/expenses`)
        .send(expense(ids.me, 10, [[ids.me, 10]]))
        .expect(201);
      await as(stranger)
        .get(`/groups/${groupId}/expenses/${created.id}`)
        .expect(404);
      await as(stranger)
        .put(`/groups/${groupId}/expenses/${created.id}`)
        .send(expense(ids.me, 10, [[ids.me, 10]]))
        .expect(404);
      await as(stranger)
        .delete(`/groups/${groupId}/expenses/${created.id}`)
        .expect(404);
      await as(me).get(`/groups/${groupId}/expenses/not-a-uuid`).expect(404);

      const other = await setup();
      await as(me)
        .put(`/groups/${groupId}/expenses/${created.id}`)
        .send(expense(ids.me, 10, [[other.ids.anna, 10]]))
        .expect(422);
    });
  });

  describe('участники', () => {
    it('участника без кошелька и без долгов можно удалить; имя освобождается', async () => {
      const { me, groupId, ids } = await setup();
      const { body } = await as(me)
        .delete(`/groups/${groupId}/members/${ids.anna}`)
        .expect(200);
      expect(body).toEqual({ left: false });
      expect(
        (await membersOf(me, groupId)).map((member) => member.name),
      ).not.toContain('Анна');
      await as(me)
        .post(`/groups/${groupId}/members`)
        .send({ displayName: 'Анна' })
        .expect(201);
      // Удалённого нельзя указать в новом расходе
      await as(me)
        .post(`/groups/${groupId}/expenses`)
        .send(expense(ids.me, 10, [[ids.anna, 10]]))
        .expect(422);
    });

    it('с долгами удалить нельзя (409), участника с кошельком — тоже (403)', async () => {
      const { me, groupId, ids } = await setup();
      await as(me)
        .post(`/groups/${groupId}/expenses`)
        .send(
          expense(ids.me, 20, [
            [ids.me, 10],
            [ids.anna, 10],
          ]),
        )
        .expect(201);
      await as(me).delete(`/groups/${groupId}/members/${ids.anna}`).expect(409);
      await as(me)
        .delete(`/groups/${groupId}/members/${ids.friend}`)
        .expect(403);
      await as(me).delete(`/groups/${groupId}/members/${ids.me}`).expect(409);
    });

    it('выход из группы: доступ пропадает, запросы отменяются, вернуться можно по ссылке', async () => {
      const { me, friend, groupId, ids } = await setup();
      // Друг должен мне 10 и вернул наличными — долгов нет, но был запрос
      await as(me)
        .post(`/groups/${groupId}/expenses`)
        .send(
          expense(ids.me, 20, [
            [ids.me, 10],
            [ids.friend, 10],
          ]),
        )
        .expect(201);
      await as(me)
        .post(`/groups/${groupId}/cash-payments`)
        .send({ memberId: ids.friend, amount: 10 })
        .expect(201);

      const { body } = await as(friend)
        .delete(`/groups/${groupId}/members/${ids.friend}`)
        .expect(200);
      expect(body).toEqual({ left: true });
      await as(friend).get(`/groups/${groupId}/overview`).expect(404);
      const home = (await as(friend).get('/me/overview').expect(200)).body;
      expect(home.groups).toHaveLength(0);
      expect(
        (await membersOf(me, groupId)).map((member) => member.name),
      ).not.toContain('Друг');

      const { body: invite } = await as(me)
        .post(`/groups/${groupId}/invites`)
        .send({})
        .expect(201);
      const { body: joined } = await as(friend)
        .post(`/invites/${invite.code}/accept`)
        .expect(200);
      expect(joined.alreadyMember).toBe(false);
      expect(joined.memberId).not.toBe(ids.friend);
    });
  });

  describe('приглашения', () => {
    it('список действующих ссылок и отзыв: превью и вход отвечают 410', async () => {
      const { me, friend, groupId, ids } = await setup();
      const { body: general } = await as(me)
        .post(`/groups/${groupId}/invites`)
        .send({})
        .expect(201);
      const { body: personal } = await as(me)
        .post(`/groups/${groupId}/invites`)
        .send({ claimMemberId: ids.anna })
        .expect(201);

      const { body: list } = await as(friend)
        .get(`/groups/${groupId}/invites`)
        .expect(200);
      expect(list.map((item: { code: string }) => item.code)).toEqual([
        general.code,
        personal.code,
      ]);
      expect(list[1]).toMatchObject({
        claimMemberName: 'Анна',
        uses: 0,
        url: `${ORIGIN}/join/${personal.code}`,
      });

      // Отозвать может любой участник
      await as(friend)
        .delete(`/groups/${groupId}/invites/${general.code}`)
        .expect(204);
      await as(friend)
        .delete(`/groups/${groupId}/invites/${general.code}`)
        .expect(404);
      await as().get(`/invites/${general.code}`).expect(410);
      const newcomer = await signIn(app);
      await as(newcomer).post(`/invites/${general.code}/accept`).expect(410);
      const { body: rest } = await as(me)
        .get(`/groups/${groupId}/invites`)
        .expect(200);
      expect(rest).toHaveLength(1);

      const stranger = await signIn(app);
      await as(stranger).get(`/groups/${groupId}/invites`).expect(404);
      await as(stranger)
        .delete(`/groups/${groupId}/invites/${personal.code}`)
        .expect(404);
    });

    it('удалённый участник: персональная ссылка на него отзывается', async () => {
      const { me, groupId, ids } = await setup();
      const { body: personal } = await as(me)
        .post(`/groups/${groupId}/invites`)
        .send({ claimMemberId: ids.anna })
        .expect(201);
      await as(me).delete(`/groups/${groupId}/members/${ids.anna}`).expect(200);
      await as().get(`/invites/${personal.code}`).expect(410);
    });
  });

  describe('запросы оплаты', () => {
    const requestDebt = async (
      me: TestSession,
      groupId: string,
      memberIds: string[],
    ) =>
      (
        await as(me)
          .post(`/groups/${groupId}/payment-requests`)
          .send({
            token: 'USDC',
            recipient: me.wallet.address,
            memberIds,
            message: '',
            remindInDays: null,
          })
          .expect(201)
      ).body as Array<{ code: string; memberId: string }>;

    const owe = async (
      me: TestSession,
      groupId: string,
      ids: { me: string; friend: string; anna: string },
    ) =>
      as(me)
        .post(`/groups/${groupId}/expenses`)
        .send(
          expense(ids.me, 90, [
            [ids.me, 30],
            [ids.friend, 30],
            [ids.anna, 30],
          ]),
        )
        .expect(201);

    it('отмена: ссылка отвечает 410, в «Отправленных» запроса нет, повторно — 404', async () => {
      const { me, friend, groupId, ids } = await setup();
      await owe(me, groupId, ids);
      const [request] = await requestDebt(me, groupId, [ids.friend]);
      const code = request?.code ?? '';

      // Чужой запрос отменить нельзя
      await as(friend)
        .delete(`/groups/${groupId}/payment-requests/${code}`)
        .expect(404);
      await as(me)
        .delete(`/groups/${groupId}/payment-requests/${code}`)
        .expect(204);
      const { body: preview } = await as().get(`/payment-requests/${code}`);
      expect(preview.statusCode).toBe(410);
      expect(preview.message).toBe('Запрос отменён');
      const { body: sent } = await as(me)
        .get(`/groups/${groupId}/payment-requests`)
        .expect(200);
      expect(sent).toHaveLength(0);
      await as(me)
        .delete(`/groups/${groupId}/payment-requests/${code}`)
        .expect(404);
      // Новый запрос тому же должнику создаётся заново
      const [again] = await requestDebt(me, groupId, [ids.friend]);
      expect(again?.code).not.toBe(code);
    });

    it('напоминание: текст со ссылкой, не чаще раза в сутки', async () => {
      const { me, friend, groupId, ids } = await setup();
      await owe(me, groupId, ids);
      const [request] = await requestDebt(me, groupId, [ids.friend]);
      const code = request?.code ?? '';

      const { body: reminder } = await as(me)
        .post(`/groups/${groupId}/payment-requests/${code}/remind`)
        .expect(200);
      expect(reminder.url).toBe(`${ORIGIN}/r/${code}`);
      expect(reminder.text).toContain('Друг');
      expect(reminder.text).toContain('30 USDC');
      expect(reminder.text).toContain(reminder.url);
      expect(
        new Date(reminder.nextReminderAt).getTime() -
          new Date(reminder.remindedAt).getTime(),
      ).toBe(24 * 3_600_000);

      await as(me)
        .post(`/groups/${groupId}/payment-requests/${code}/remind`)
        .expect(429);
      await as(friend)
        .post(`/groups/${groupId}/payment-requests/${code}/remind`)
        .expect(404);
      const { body: sent } = await as(me)
        .get(`/groups/${groupId}/payment-requests`)
        .expect(200);
      expect(sent[0].remindedAt).toBe(reminder.remindedAt);

      await as(me)
        .delete(`/groups/${groupId}/payment-requests/${code}`)
        .expect(204);
      await as(me)
        .post(`/groups/${groupId}/payment-requests/${code}/remind`)
        .expect(409);
    });
  });

  describe('наличные', () => {
    const setupDebt = async () => {
      const context = await setup();
      const { me, groupId, ids } = context;
      await as(me)
        .post(`/groups/${groupId}/expenses`)
        .send(
          expense(ids.me, 90, [
            [ids.me, 30],
            [ids.friend, 30],
            [ids.anna, 30],
          ]),
        )
        .expect(201);
      return context;
    };

    it('получатель отмечает частичный возврат: долг уменьшается, открытый запрос отменяется', async () => {
      const { me, friend, groupId, ids } = await setupDebt();
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

      const { body } = await as(me)
        .post(`/groups/${groupId}/cash-payments`)
        .send({ memberId: ids.friend, amount: 12.5 })
        .expect(201);
      expect(body).toEqual({
        memberId: ids.friend,
        amount: 12.5,
        remaining: 17.5,
      });
      const mine = await overview(me, groupId);
      expect(mine.debts).toEqual(
        expect.arrayContaining([
          { fromId: ids.friend, toId: ids.me, amount: 17.5 },
        ]),
      );
      expect(
        (await as().get(`/payment-requests/${requests[0].code}`)).status,
      ).toBe(410);

      const home = (await as(friend).get('/me/overview').expect(200)).body;
      expect(home.activity[0]).toMatchObject({
        type: 'cash',
        myDelta: -12.5,
        signature: null,
      });
    });

    it('полный возврат закрывает запрос как оплаченный', async () => {
      const { me, groupId, ids } = await setupDebt();
      const { body: requests } = await as(me)
        .post(`/groups/${groupId}/payment-requests`)
        .send({
          token: 'USDC',
          recipient: me.wallet.address,
          memberIds: [ids.anna],
          message: '',
          remindInDays: null,
        })
        .expect(201);
      await as(me)
        .post(`/groups/${groupId}/cash-payments`)
        .send({ memberId: ids.anna, amount: 30 })
        .expect(201);
      const { body: preview } = await as()
        .get(`/payment-requests/${requests[0].code}`)
        .expect(200);
      expect(preview).toMatchObject({ status: 'paid', signature: null });
      const { body: sent } = await as(me)
        .get(`/groups/${groupId}/payment-requests`)
        .expect(200);
      expect(sent[0]).toMatchObject({ status: 'paid', signature: null });
      // Долга больше нет
      await as(me)
        .post(`/groups/${groupId}/cash-payments`)
        .send({ memberId: ids.anna, amount: 1 })
        .expect(409);
    });

    it('должник сам себе долг не закроет; больше долга — 422; чужая группа — 404', async () => {
      const { me, friend, groupId, ids } = await setupDebt();
      await as(friend)
        .post(`/groups/${groupId}/cash-payments`)
        .send({ memberId: ids.me, amount: 30 })
        .expect(409);
      await as(me)
        .post(`/groups/${groupId}/cash-payments`)
        .send({ memberId: ids.friend, amount: 30.01 })
        .expect(422);
      await as(me)
        .post(`/groups/${groupId}/cash-payments`)
        .send({ memberId: ids.me, amount: 1 })
        .expect(422);
      await as(me)
        .post(`/groups/${groupId}/cash-payments`)
        .send({ memberId: ids.friend, amount: 0 })
        .expect(400);
      const stranger = await signIn(app);
      await as(stranger)
        .post(`/groups/${groupId}/cash-payments`)
        .send({ memberId: ids.friend, amount: 1 })
        .expect(404);
    });
  });

  describe('профиль и аккаунт', () => {
    it('имя профиля заменяет имя по умолчанию в группах, ручные имена не трогает', async () => {
      const me = await signIn(app);
      const { body: first } = await as(me)
        .post('/groups')
        .send({ name: 'Дом', kind: 'home' })
        .expect(201);
      const { body: second } = await as(me)
        .post('/groups')
        .send({ name: 'Ужин', kind: 'food' })
        .expect(201);
      await as(me)
        .post(`/groups/${second.id}/members`)
        .send({ displayName: 'Адиль' })
        .expect(201);
      // В третьей группе меня назвали вручную
      const { body: third } = await as(me)
        .post('/groups')
        .send({ name: 'Работа', kind: 'other' })
        .expect(201);
      await db
        .update(groupMembers)
        .set({ displayName: 'Шеф' })
        .where(eq(groupMembers.groupId, third.id));

      const { body: profile } = await as(me)
        .patch('/me')
        .send({ displayName: '  Адиль ' })
        .expect(200);
      expect(profile.displayName).toBe('Адиль');

      const myName = async (groupId: string) =>
        (await membersOf(me, groupId)).find((member) => member.isMe)?.name;
      expect(await myName(first.id)).toBe('Адиль');
      expect(await myName(second.id)).toBe('Адиль 2');
      expect(await myName(third.id)).toBe('Шеф');

      // Новое имя меняет и прежнее имя профиля
      await as(me).patch('/me').send({ displayName: 'Адик' }).expect(200);
      expect(await myName(first.id)).toBe('Адик');
      expect(await myName(second.id)).toBe('Адик');

      await as(me).patch('/me').send({ displayName: '' }).expect(400);
      await as(me)
        .patch('/me')
        .send({ displayName: 'x', extra: 1 })
        .expect(400);
    });

    it('удаление аккаунта: токены отозваны, в группе остаётся участник без кошелька', async () => {
      const { me, friend, groupId, ids } = await setup();
      await as(me)
        .post(`/groups/${groupId}/expenses`)
        .send(
          expense(ids.friend, 20, [
            [ids.friend, 10],
            [ids.me, 10],
          ]),
        )
        .expect(201);

      // Без заголовков фронтенда — нельзя
      await as(me).delete('/me').expect(403);
      const response = await as(me)
        .delete('/me')
        .set(ORIGIN_HEADERS)
        .expect(204);
      expect(String(response.headers['set-cookie'])).toContain('divra_rt=;');

      await as(me).get('/me').expect(401);
      const members = await membersOf(friend, groupId);
      const former = members.find((member) => member.id === ids.me);
      expect(former).toMatchObject({ status: 'pending' });
      const theirs = await overview(friend, groupId);
      expect(theirs.debts).toEqual([
        { fromId: ids.me, toId: ids.friend, amount: 10 },
      ]);

      // Тот же кошелёк — уже новый пользователь без групп
      const again = await signIn(app, me.wallet);
      expect(again.userId).not.toBe(me.userId);
      const home = (await as(again).get('/me/overview').expect(200)).body;
      expect(home.groups).toHaveLength(0);
    });
  });
});
