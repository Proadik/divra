import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

type Duration = `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;

/** '15m', '7d', '30s' — формат, который понимает @nestjs/authentication */
const duration = z
  .string()
  .regex(/^\d+(ms|s|m|h|d)$/, 'Формат: 15m, 7d, 30s')
  .transform((value) => value as Duration);

const PLACEHOLDER_SECRET = /replace-me|change-me|secret$/i;

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

    JWT_SECRET: z
      .string()
      .refine(
        (value) => Buffer.byteLength(value, 'utf8') >= 32,
        'Не короче 32 байт',
      ),
    JWT_ISSUER: z.string().min(1).default('divra-api'),
    JWT_AUDIENCE: z.string().min(1).default('divra-web'),
    ACCESS_TOKEN_TTL: duration.default('15m'),
    REFRESH_TOKEN_TTL: duration.default('7d'),
    REFRESH_FAMILY_TTL: duration.default('30d'),

    APP_ORIGIN: z
      .url({ protocol: /^https?$/ })
      .transform((value) => new URL(value).origin),
    COOKIE_SECURE: booleanString.default(true),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),

    SOLANA_CLUSTER: z
      .enum(['devnet', 'testnet', 'mainnet-beta'])
      .default('devnet'),
    SOLANA_RPC_URL: z
      .union([z.url({ protocol: /^https$/ }), z.literal('')])
      .default(''),
    /** Как часто искать оплату открытых запросов в сети, мс. 0 — не искать в фоне */
    PAYMENT_WATCH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(3_600_000)
      .default(20_000),
    CHALLENGE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(900)
      .default(300),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') {
      return;
    }
    // В production ошибки конфигурации, которые ослабляют защиту, — не предупреждение, а отказ стартовать
    if (PLACEHOLDER_SECRET.test(value.JWT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'Похоже на пример из .env.example',
      });
    }
    if (!value.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'В production только true',
      });
    }
    if (!value.APP_ORIGIN.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'В production только https',
      });
    }
  });

export type AppConfig = z.infer<typeof schema> & {
  /** Домен фронтенда — он попадает в сообщение для подписи */
  APP_DOMAIN: string;
  /** RPC с подставленным публичным адресом кластера */
  SOLANA_RPC: string;
};

export const APP_CONFIG = Symbol('APP_CONFIG');

export const loadConfig = (
  source: NodeJS.ProcessEnv = process.env,
): AppConfig => {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Значения не печатаем: среди них секреты
    throw new Error(
      `Некорректные переменные окружения:\n${z.prettifyError(parsed.error)}`,
    );
  }
  const config = parsed.data;
  return {
    ...config,
    APP_DOMAIN: new URL(config.APP_ORIGIN).host,
    SOLANA_RPC:
      config.SOLANA_RPC_URL ||
      `https://api.${config.SOLANA_CLUSTER}.solana.com`,
  };
};
