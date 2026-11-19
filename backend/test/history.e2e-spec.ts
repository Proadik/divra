import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { groupMembers, paymentRequests } from '../src/database/schema/index.js';
import { type TestSession, signIn } from './session.js';
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

interface HistoryItem {
  id: string;
  signature: string;
  amount: number;
  direction: 'in' | 'out';
  counterparty: { name: string | null; address: string | null };
  countedIn: string | null;
  suggested: boolean;
  createdAt: string;
}

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const STRANGER = 'En8us9A5d7H27SRP57bwt3Cv63Z57q34DkcLh5Vs1KFY';
const units = (dollars: number): bigint => BigInt(Math.round(dollars * 1e6));

/** «История»: переводы в сети с участием пользователя, страницами по курсору */
describe('История переводов (e2e)', () => {
  let app: INestApplication<App>;
  let db: Awaited<ReturnType<typeof createTestApp>>['db'];
  let stream: FakeTransferStream;
  let chain: FakePaymentLookup;
  let seq = 0;

  beforeAll(async () => {
    ({ app, db, stream, chain } = await createTestApp());
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
    const members = (
      await as(me).get(`/groups/${group.id}/overview`).expect(200)
    ).body.members as Member[];
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

  const transfer = async (
    from: string,
    to: string,
    dollars: number,
  ): Promise<string> => {
    seq += 1;
    const signature = `hist-${seq}`;
    await stream.emit({
      signature,
      slot: 5000 + seq,
      accounts: [],
      changes: [
        { owner: from, mint: USDC, delta: -units(dollars) },
        { owner: to, mint: USDC, delta: units(dollars) },
      ],
    });
    chain.received.set(
      signature,
      new Map([
        [from, -units(dollars)],
        [to, units(dollars)],
      ]),
    );
    return signature;
  };

  const all = async (session: TestSession): Promise<HistoryItem[]> => {
    const items: HistoryItem[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor
        ? `?limit=2&cursor=${encodeURIComponent(cursor)}`
        : '?limit=2';
      const { body } = await as(session).get(`/me/history${query}`).expect(200);
      items.push(...(body.items as HistoryItem[]));
      cursor = body.nextCursor as string | null;
    } while (cursor);
    return items;
  };

  it('переводы из потока: входящие и исходящие, чужой кошелёк, подсказка', async () => {
    const { me, friend } = await setup();
    await transfer(friend.wallet.address, me.wallet.address, 5);
    await transfer(me.wallet.address, friend.wallet.address, 2);
    await transfer(STRANGER, me.wallet.address, 1);

    const { body } = await as(me).get('/me/history').expect(200);
    expect(body.nextCursor).toBeNull();
    expect(body.items).toHaveLength(3);
    const [fromStranger, toFriend, fromFriend] = body.items as HistoryItem[];
    expect(fromStranger).toMatchObject({
      amount: 1,
      direction: 'in',
      counterparty: { name: null, address: STRANGER },
      countedIn: null,
      suggested: false,
    });
    expect(toFriend).toMatchObject({
      amount: 2,
      direction: 'out',
      counterparty: { name: 'Друг', address: friend.wallet.address },
    });
    // Друг должен мне — его перевод ждёт решения
    expect(fromFriend).toMatchObject({
      amount: 5,
      direction: 'in',
      suggested: true,
    });

    // У друга — только его два перевода, у чужого кошелька истории в Divra нет
    const theirs = (await as(friend).get('/me/history').expect(200)).body;
    expect(theirs.items.map((item: HistoryItem) => item.direction)).toEqual([
      'in',
      'out',
    ]);
  });

  it('«засчитать» отмечает перевод в истории группой', async () => {
    const { me, friend, groupId } = await setup();
    const signature = await transfer(
      friend.wallet.address,
      me.wallet.address,
      10,
    );
    const [hint] = (await as(me).get('/me/detected-transfers')).body;
    await as(me)
      .post(`/detected-transfers/${hint.id}/apply`)
      .send({ groupId })
      .expect(200);

    const items = (await as(me).get('/me/history')).body.items as HistoryItem[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      signature,
      countedIn: 'Поездка',
      suggested: false,
    });
  });

  it('оплата по запросу без потока тоже в истории — один раз', async () => {
    const { me, groupId, ids } = await setup();
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
    chain.transfers.set(row?.reference ?? '', [
      { signature: 'paid-by-request', rawAmount: units(30) },
    ]);
    await as().get(`/payment-requests/${requests[0].code}`).expect(200);

    const items = (await as(me).get('/me/history')).body.items as HistoryItem[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      signature: 'paid-by-request',
      amount: 30,
      direction: 'in',
      counterparty: { name: 'Друг', address: null },
      countedIn: 'Поездка',
    });
  });

  it('страницы по курсору: всё по одному разу, новые сверху', async () => {
    const { me, friend } = await setup();
    const signatures: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      signatures.push(await transfer(STRANGER, me.wallet.address, index + 1));
    }
    signatures.push(
      await transfer(me.wallet.address, friend.wallet.address, 1),
    );

    const items = await all(me);
    expect(items.map((item) => item.signature)).toEqual(
      [...signatures].reverse(),
    );
    const times = items.map((item) => Date.parse(item.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('проверка запроса: кривой курсор и лимит — 400, без входа — 401', async () => {
    const { me } = await setup();
    await as(me).get('/me/history?cursor=bad').expect(400);
    await as(me).get('/me/history?limit=100').expect(400);
    await as(me).get('/me/history?limit=0').expect(400);
    await as(me).get('/me/history?foo=1').expect(400);
    await as().get('/me/history').expect(401);
  });
});
