import { loadConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/divra',
  JWT_SECRET: 'a'.repeat(48),
  APP_ORIGIN: 'http://localhost:5173/',
};

describe('loadConfig', () => {
  it('подставляет значения по умолчанию и выводит домен', () => {
    const config = loadConfig(base);

    expect(config.APP_ORIGIN).toBe('http://localhost:5173');
    expect(config.APP_DOMAIN).toBe('localhost:5173');
    expect(config.COOKIE_SECURE).toBe(true);
    expect(config.SOLANA_RPC).toBe('https://api.devnet.solana.com');
  });

  it('не принимает короткий ключ JWT', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('не печатает значения в ошибке', () => {
    expect(() =>
      loadConfig({ ...base, JWT_SECRET: 'short-secret' }),
    ).not.toThrow(/short-secret/);
  });

  it('в production отказывается от небезопасных настроек', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        JWT_SECRET: 'replace-me-with-openssl-rand-base64-48-output-xxxxxxxx',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow(
      /JWT_SECRET[\s\S]*COOKIE_SECURE[\s\S]*APP_ORIGIN|COOKIE_SECURE|JWT_SECRET/,
    );
  });
});
