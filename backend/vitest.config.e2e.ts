import { defineConfig } from 'vitest/config';

// Всё приложение на PGlite (PostgreSQL в процессе): настоящий SQL, миграции, HTTP через supertest.
// Своя база не нужна — тесты не трогают DATABASE_URL.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unused@localhost/unused',
      JWT_SECRET: 'test-secret-test-secret-test-secret-0123456789',
      APP_ORIGIN: 'http://localhost:5173',
      COOKIE_SECURE: 'false',
      SOLANA_CLUSTER: 'devnet',
      // Тесты шлют X-Forwarded-For: у каждого теста свой «IP», лимиты не мешают друг другу
      TRUST_PROXY: '1',
      // Фоновый поиск оплат в тестах не запускаем — проверки вызываются явно
      PAYMENT_WATCH_INTERVAL_MS: '0',
    },
  },
});
