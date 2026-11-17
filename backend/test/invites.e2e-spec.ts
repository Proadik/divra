import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { invites } from '../src/database/schema/index.js';
import { type TestSession, signIn } from './session.js';
import { createTestApp, freshIp } from './test-app.js';

interface Member {
  id: string;
  name: string;
  isMe: boolean;
  status: string;
  address: string | null;
}

describe('Приглашения (e2e)', () => {
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

  const short = (session: TestSession): string =>
    `${session.wallet.address.slice(0, 4)}…${session.wallet.address.slice(-4)}`;

  const groupOf = async (owner: TestSession) => {
    const { body } = await as(owner)
      .post('/groups')
      .send({ name: 'Поездка', kind: 'trip' })
      .expect(201);
    return body.id as string;
  };

  const membersOf = async (session: TestSession, groupId: string) =>
    (await as(session).get(`/groups/${groupId}/overview`).expect(200)).body
      .members as Member[];

  it('общая ссылка: превью без входа, вход по подписи — участник с кошельком', async () => {
    const owner = await signIn(app);
    const groupId = await groupOf(owner);
    const { body: invite } = await as(owner)
      .post(`/groups/${groupId}/invites`)
      .send({})
      .expect(201);
    expect(invite).toMatchObject({
      url: `http://localhost:5173/join/${invite.code}`,
      claimMemberId: null,
    });
    expect(invite.code).toMatch(/^[\w-]{22}$/);

    const { body: preview } = await as(null)
      .get(`/invites/${invite.code}`)
      .expect(200);
    expect(preview).toEqual({
      code: invite.code,
      groupId,
      groupName: 'Поездка',
      invitedByName: short(owner),
      membersCount: 1,
      claimMemberName: null,
      expiresAt: invite.expiresAt,
    });

    await as(null).post(`/invites/${invite.code}/accept`).expect(401);

    const friend = await signIn(app);
    const { body: joined } = await as(friend)
      .post(`/invites/${invite.code}/accept`)
      .expect(200);
    expect(joined).toMatchObject({ groupId, alreadyMember: false });

    const members = await membersOf(owner, groupId);
    expect(
      members.find((member) => member.id === joined.memberId),
    ).toMatchObject({
      name: short(friend),
      status: 'active',
      address: friend.wallet.address,
    });
    const home = await as(friend).get('/me/overview').expect(200);
    expect(home.body.groups.map((group: { id: string }) => group.id)).toEqual([
      groupId,
    ]);

    // Общая ссылка работает для нескольких человек, повторный вход ничего не меняет
    const third = await signIn(app);
    await as(third).post(`/invites/${invite.code}/accept`).expect(200);
    const again = await as(friend)
      .post(`/invites/${invite.code}/accept`)
      .expect(200);
    expect(again.body).toEqual({
      groupId,
      memberId: joined.memberId,
      alreadyMember: true,
    });
    expect(await membersOf(owner, groupId)).toHaveLength(3);
  });

  it('персональная ссылка: друг забирает участника вместе с долгом, второй раз — 410', async () => {
    const owner = await signIn(app);
    const groupId = await groupOf(owner);
    const { body: anna } = await as(owner)
      .post(`/groups/${groupId}/members`)
      .send({ displayName: 'Анна' })
      .expect(201);
    const ownerId = (await membersOf(owner, groupId)).find((m) => m.isMe)?.id;
    await as(owner)
      .post(`/groups/${groupId}/expenses`)
      .send({
        title: 'Ужин',
        category: 'food',
        paidById: ownerId,
        amount: 60,
        splitMode: 'equal',
        shares: [
          { memberId: ownerId, amount: 30 },
          { memberId: anna.id, amount: 30 },
        ],
      })
      .expect(201);

    const { body: invite } = await as(owner)
      .post(`/groups/${groupId}/invites`)
      .send({ claimMemberId: anna.id })
      .expect(201);
    expect(invite.claimMemberId).toBe(anna.id);
    const { body: preview } = await as(null)
      .get(`/invites/${invite.code}`)
      .expect(200);
    expect(preview.claimMemberName).toBe('Анна');
    expect(preview.membersCount).toBe(2);

    const friend = await signIn(app);
    const { body: joined } = await as(friend)
      .post(`/invites/${invite.code}/accept`)
      .expect(200);
    expect(joined).toEqual({
      groupId,
      memberId: anna.id,
      alreadyMember: false,
    });

    const { body: theirs } = await as(friend)
      .get(`/groups/${groupId}/overview`)
      .expect(200);
    expect(theirs.members.find((m: Member) => m.isMe)).toMatchObject({
      id: anna.id,
      name: 'Анна',
      status: 'active',
    });
    expect(theirs.myBalance).toBe(-30);
    // У хозяина Анна теперь с кошельком — ей можно перевести
    expect(
      (await membersOf(owner, groupId)).find((m) => m.id === anna.id),
    ).toMatchObject({ status: 'active', address: friend.wallet.address });

    await as(null).get(`/invites/${invite.code}`).expect(410);
    const other = await signIn(app);
    await as(other).post(`/invites/${invite.code}/accept`).expect(410);
    // А тот, кто уже забрал, просто снова «в группе»
    const again = await as(friend)
      .post(`/invites/${invite.code}/accept`)
      .expect(200);
    expect(again.body.alreadyMember).toBe(true);
  });

  it('одну персональную ссылку одновременно забирает только один', async () => {
    const owner = await signIn(app);
    const groupId = await groupOf(owner);
    const { body: anna } = await as(owner)
      .post(`/groups/${groupId}/members`)
      .send({ displayName: 'Анна' })
      .expect(201);
    const { body: invite } = await as(owner)
      .post(`/groups/${groupId}/invites`)
      .send({ claimMemberId: anna.id })
      .expect(201);
    const people = await Promise.all([signIn(app), signIn(app), signIn(app)]);
    const statuses = await Promise.all(
      people.map((person) =>
        as(person)
          .post(`/invites/${invite.code}/accept`)
          .then((response) => response.status),
      ),
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 410)).toHaveLength(2);
  });

  it('нельзя: ссылка на участника с кошельком или из другой группы, чужая группа', async () => {
    const owner = await signIn(app);
    const groupId = await groupOf(owner);
    const ownerId = (await membersOf(owner, groupId))[0]?.id;
    await as(owner)
      .post(`/groups/${groupId}/invites`)
      .send({ claimMemberId: ownerId })
      .expect(409);

    const other = await signIn(app);
    const otherGroup = await groupOf(other);
    const { body: stranger } = await as(other)
      .post(`/groups/${otherGroup}/members`)
      .send({ displayName: 'Чужой' })
      .expect(201);
    await as(owner)
      .post(`/groups/${groupId}/invites`)
      .send({ claimMemberId: stranger.id })
      .expect(409);
    await as(other).post(`/groups/${groupId}/invites`).send({}).expect(404);
    await as(owner)
      .post(`/groups/${groupId}/invites`)
      .send({ claimMemberId: 'x' })
      .expect(400);
  });

  it('истёкшая, неизвестная и кривая ссылка', async () => {
    const owner = await signIn(app);
    const groupId = await groupOf(owner);
    const { body: invite } = await as(owner)
      .post(`/groups/${groupId}/invites`)
      .send({})
      .expect(201);
    await db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.code, invite.code));
    await as(null).get(`/invites/${invite.code}`).expect(410);
    const friend = await signIn(app);
    await as(friend).post(`/invites/${invite.code}/accept`).expect(410);

    await as(null)
      .get(`/invites/${'A'.repeat(22)}`)
      .expect(404);
    await as(null).get('/invites/short').expect(404);
    await as(friend)
      .post(`/invites/${'A'.repeat(22)}/accept`)
      .expect(404);
  });

  it('имя по умолчанию не конфликтует с уже занятым', async () => {
    const owner = await signIn(app);
    const groupId = await groupOf(owner);
    const friend = await signIn(app);
    // Кто-то заранее добавил участника с таким же именем
    await as(owner)
      .post(`/groups/${groupId}/members`)
      .send({ displayName: short(friend) })
      .expect(201);
    const { body: invite } = await as(owner)
      .post(`/groups/${groupId}/invites`)
      .send({})
      .expect(201);
    const { body: joined } = await as(friend)
      .post(`/invites/${invite.code}/accept`)
      .expect(200);
    const me = (await membersOf(friend, groupId)).find(
      (member) => member.id === joined.memberId,
    );
    expect(me?.name).toBe(`${short(friend)} 2`);
  });
});
