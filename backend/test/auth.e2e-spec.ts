import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { type TestWallet, createTestWallet } from './wallet.js';
import { createTestApp, freshIp } from './test-app.js';

const ORIGIN = 'http://localhost:5173';
const COOKIE = 'divra_rt';

describe('Вход кошельком (e2e)', () => {
  let app: INestApplication<App>;
  let db: Awaited<ReturnType<typeof createTestApp>>['db'];
  let ip: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    ip = freshIp();
  });

  const post = (path: string) =>
    request(app.getHttpServer())
      .post(`/api${path}`)
      .set('X-Divra-Client', 'web')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip);

  const challenge = async (wallet: TestWallet) =>
    (
      await post('/auth/wallet/challenge')
        .send({ chain: 'solana', address: wallet.address })
        .expect(200)
    ).body as {
      challengeId: string;
      transaction: string;
      message: string;
      expiresAt: string;
    };

  const signIn = async (wallet: TestWallet) => {
    const issued = await challenge(wallet);
    const response = await post('/auth/wallet/verify')
      .send({
        challengeId: issued.challengeId,
        chain: 'solana',
        address: wallet.address,
        signedPayload: await wallet.sign(issued.transaction),
      })
      .expect(200);
    return { response, cookie: refreshCookie(response.headers['set-cookie']) };
  };

  const refreshCookie = (header: string[] | string | undefined): string => {
    const cookies = Array.isArray(header) ? header : header ? [header] : [];
    const found = cookies.find((value) => value.startsWith(`${COOKIE}=`));
    if (!found) {
      throw new Error('нет refresh-cookie');
    }
    return found.split(';')[0] ?? '';
  };

  const decodeJwt = (token: string) => {
    const [header = '', payload = ''] = token.split('.');
    return {
      header: JSON.parse(Buffer.from(header, 'base64url').toString()) as Record<
        string,
        unknown
      >,
      payload: JSON.parse(
        Buffer.from(payload, 'base64url').toString(),
      ) as Record<string, unknown>,
    };
  };

  it('регистрирует по подписи и выдаёт JWT; refresh — только в HttpOnly-cookie', async () => {
    const wallet = await createTestWallet();
    const issued = await challenge(wallet);

    expect(issued.message).toContain(`Адрес: ${wallet.address}`);
    expect(issued.message).toContain('Домен: localhost:5173');

    const response = await post('/auth/wallet/verify')
      .send({
        challengeId: issued.challengeId,
        chain: 'solana',
        address: wallet.address,
        signedPayload: await wallet.sign(issued.transaction),
      })
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(response.body.user).toMatchObject({
      chain: 'solana',
      address: wallet.address,
      created: true,
    });
    expect(response.body).not.toHaveProperty('refreshToken');

    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\/api\/auth/);

    const { header, payload } = decodeJwt(response.body.accessToken);
    expect(header).toMatchObject({ alg: 'HS256', typ: 'at+jwt' });
    expect(payload).toMatchObject({
      sub: response.body.user.id,
      iss: 'divra-api',
      aud: 'divra-web',
      amr: ['swk'],
    });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(900);
  });

  it('с JWT открывается /me; без него, с битым или чужим токеном — 401', async () => {
    const wallet = await createTestWallet();
    const { response } = await signIn(wallet);
    const token: string = response.body.accessToken;

    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body).toMatchObject({
      id: response.body.user.id,
      wallets: [{ chain: 'solana', address: wallet.address }],
    });

    await request(app.getHttpServer()).get('/api/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${token}x`)
      .expect(401);

    // Тот же payload, подписанный другим ключом
    const [header, payload] = token.split('.');
    const forged = createHmac(
      'sha256',
      'another-secret-another-secret-another-secret!',
    )
      .update(`${header}.${payload}`)
      .digest('base64url');
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${header}.${payload}.${forged}`)
      .expect(401);

    // alg=none не принимается никогда
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt' })).toString('base64url')}.${payload}.`;
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${none}`)
      .expect(401);
  });

  it('повторный вход тем же кошельком — тот же пользователь', async () => {
    const wallet = await createTestWallet();
    const first = await signIn(wallet);
    const second = await signIn(wallet);

    expect(second.response.body.user).toMatchObject({
      id: first.response.body.user.id,
      created: false,
    });
  });

  it('вызов одноразовый: повтор той же подписи — 401', async () => {
    const wallet = await createTestWallet();
    const issued = await challenge(wallet);
    const body = {
      challengeId: issued.challengeId,
      chain: 'solana',
      address: wallet.address,
      signedPayload: await wallet.sign(issued.transaction),
    };

    await post('/auth/wallet/verify').send(body).expect(200);
    await post('/auth/wallet/verify').send(body).expect(401);
  });

  it('подпись чужим ключом — 401, и вызов сгорает даже после ошибки', async () => {
    const wallet = await createTestWallet();
    const thief = await createTestWallet();
    const issued = await challenge(wallet);

    await post('/auth/wallet/verify')
      .send({
        challengeId: issued.challengeId,
        chain: 'solana',
        address: wallet.address,
        signedPayload: await thief.forgeAs(issued.transaction, wallet.address),
      })
      .expect(401);
    // Правильная подпись того же вызова уже не поможет
    await post('/auth/wallet/verify')
      .send({
        challengeId: issued.challengeId,
        chain: 'solana',
        address: wallet.address,
        signedPayload: await wallet.sign(issued.transaction),
      })
      .expect(401);
  });

  it('подпись под другим сообщением (своя транзакция вместо выданной) — 401', async () => {
    const wallet = await createTestWallet();
    const mine = await challenge(wallet);
    const other = await challenge(wallet);

    await post('/auth/wallet/verify')
      .send({
        challengeId: mine.challengeId,
        chain: 'solana',
        address: wallet.address,
        signedPayload: await wallet.sign(other.transaction),
      })
      .expect(401);
  });

  it('вызов для одного адреса нельзя использовать для другого — 401', async () => {
    const wallet = await createTestWallet();
    const other = await createTestWallet();
    const issued = await challenge(wallet);

    await post('/auth/wallet/verify')
      .send({
        challengeId: issued.challengeId,
        chain: 'solana',
        address: other.address,
        signedPayload: await wallet.sign(issued.transaction),
      })
      .expect(401);
  });

  it('просроченный вызов — 401', async () => {
    const wallet = await createTestWallet();
    const issued = await challenge(wallet);
    await db.execute(
      sql`update auth_challenges set expires_at = now() - interval '1 second' where id = ${issued.challengeId}`,
    );

    await post('/auth/wallet/verify')
      .send({
        challengeId: issued.challengeId,
        chain: 'solana',
        address: wallet.address,
        signedPayload: await wallet.sign(issued.transaction),
      })
      .expect(401);
  });

  it('refresh: ротация; повтор потраченного токена отзывает всё семейство', async () => {
    const wallet = await createTestWallet();
    const { cookie: first } = await signIn(wallet);

    const rotated = await post('/auth/refresh')
      .set('Cookie', first)
      .expect(200);
    expect(rotated.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    const second = refreshCookie(rotated.headers['set-cookie']);
    expect(second).not.toBe(first);

    // Кто-то предъявил уже потраченный токен — значит, его украли
    await post('/auth/refresh').set('Cookie', first).expect(401);
    // Отозвано всё семейство: свежий токен владельца тоже больше не работает
    await post('/auth/refresh').set('Cookie', second).expect(401);
  });

  it('выход отзывает refresh-токен и стирает cookie', async () => {
    const wallet = await createTestWallet();
    const { cookie } = await signIn(wallet);

    const out = await post('/auth/sign-out').set('Cookie', cookie).expect(204);
    expect(String(out.headers['set-cookie'])).toMatch(
      new RegExp(`${COOKIE}=;`),
    );
    await post('/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('без заголовка приложения или с чужого сайта — 403 (CSRF)', async () => {
    const wallet = await createTestWallet();
    const { cookie } = await signIn(wallet);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .set('X-Divra-Client', 'web')
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .set('X-Divra-Client', 'web')
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(403);
  });

  it('CORS разрешён только фронтенду', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/api/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-divra-client');
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const evil = await request(app.getHttpServer())
      .options('/api/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('проверяет вход: адрес, сеть, лишние поля, размер тела', async () => {
    await post('/auth/wallet/challenge')
      .send({ chain: 'solana', address: 'not-an-address' })
      .expect(400);
    await post('/auth/wallet/challenge')
      .send({ chain: 'ethereum', address: '0xabc' })
      .expect(400);
    const wallet = await createTestWallet();
    await post('/auth/wallet/challenge')
      .send({ chain: 'solana', address: wallet.address, admin: true })
      .expect(400);
    await post('/auth/wallet/challenge')
      .send({
        chain: 'solana',
        address: wallet.address,
        padding: 'x'.repeat(20_000),
      })
      .expect(413);
  });

  it('лимиты: не больше 5 живых вызовов на адрес и 10 запросов в минуту с IP', async () => {
    const wallet = await createTestWallet();
    for (let i = 0; i < 5; i += 1) {
      ip = freshIp();
      await challenge(wallet);
    }
    ip = freshIp();
    await post('/auth/wallet/challenge')
      .send({ chain: 'solana', address: wallet.address })
      .expect(429);

    ip = freshIp();
    for (let i = 0; i < 10; i += 1) {
      const other = await createTestWallet();
      await post('/auth/wallet/challenge')
        .send({ chain: 'solana', address: other.address })
        .expect(200);
    }
    const last = await createTestWallet();
    await post('/auth/wallet/challenge')
      .send({ chain: 'solana', address: last.address })
      .expect(429);
  });

  it('заголовки безопасности и /health без токена', async () => {
    const health = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(health.headers['x-powered-by']).toBeUndefined();
  });
});
