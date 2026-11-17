import { z } from 'zod'

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true')

const envSchema = z.object({
  VITE_APP_TITLE: z.string().default(''),
  /** Адрес API: абсолютный или путь. `/api` — тот же origin, в dev через прокси Vite */
  VITE_API_URL: z
    .string()
    .default('/api')
    .transform((value) => value || '/api'),
  VITE_SITE_URL: z.string().default(''),
  /** Значение по умолчанию для флагов mock.*: true — бэкенд имитируется в браузере */
  VITE_API_MOCK: booleanString.default(true),
  /**
   * Вход: true — мок в браузере, false — настоящий бэкенд (backend/, POST /auth/wallet/*).
   * Пусто — как VITE_API_MOCK. Можно войти по-настоящему, а данные групп брать из мока.
   */
  VITE_AUTH_MOCK: booleanString.optional(),
  /**
   * Группы, участники, приглашения и расходы: true — мок, false — backend/.
   * Пусто — как VITE_API_MOCK. Переключаются вместе: мок не знает групп бэкенда и наоборот.
   */
  VITE_GROUPS_MOCK: booleanString.optional(),
  /**
   * Откуда берутся фича-флаги: local — «база» в localStorage (для мока и разработки),
   * remote — GET /flags на бэкенде. По умолчанию local при VITE_API_MOCK=true.
   */
  VITE_FLAGS_SOURCE: z.enum(['local', 'remote']).optional(),
  /** remote: слушать GET /flags/stream (SSE). false — только опрос. */
  VITE_FLAGS_STREAM: booleanString.default(false),
  /** Как часто перезапрашивать флаги, мс. Страховка, если поток оборвался. */
  VITE_FLAGS_POLL_MS: z.coerce.number().int().min(5_000).default(30_000),
  VITE_SOLANA_CLUSTER: z.enum(['devnet', 'testnet', 'mainnet-beta']).default('devnet'),
  /** RPC для мока бэкенда (свежий blockhash). Пусто — публичный RPC кластера. */
  VITE_SOLANA_RPC_URL: z.union([z.url(), z.literal('')]).default(''),
})

const parsed = envSchema.safeParse(import.meta.env)

if (!parsed.success) {
  throw new Error(`Некорректные переменные окружения:\n${z.prettifyError(parsed.error)}`)
}

const raw = parsed.data

export const env = {
  APP_TITLE: raw.VITE_APP_TITLE,
  API_URL: raw.VITE_API_URL,
  SITE_URL: raw.VITE_SITE_URL,
  API_MOCK: raw.VITE_API_MOCK,
  AUTH_MOCK: raw.VITE_AUTH_MOCK ?? raw.VITE_API_MOCK,
  GROUPS_MOCK: raw.VITE_GROUPS_MOCK ?? raw.VITE_API_MOCK,
  FLAGS_SOURCE: raw.VITE_FLAGS_SOURCE ?? (raw.VITE_API_MOCK ? 'local' : 'remote'),
  FLAGS_STREAM: raw.VITE_FLAGS_STREAM,
  FLAGS_POLL_MS: raw.VITE_FLAGS_POLL_MS,
  SOLANA_CLUSTER: raw.VITE_SOLANA_CLUSTER,
  SOLANA_RPC_URL: raw.VITE_SOLANA_RPC_URL || `https://api.${raw.VITE_SOLANA_CLUSTER}.solana.com`,
  MODE: import.meta.env.MODE,
  IS_DEV: import.meta.env.DEV,
  IS_PROD: import.meta.env.PROD,
} as const
