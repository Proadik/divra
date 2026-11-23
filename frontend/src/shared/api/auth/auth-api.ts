import { env } from '@/shared/config'
import { api } from '../client'
import {
  type AccessToken,
  type UserProfile,
  type WalletChallenge,
  type WalletChallengeRequest,
  type WalletSession,
  type WalletVerifyRequest,
  accessTokenSchema,
  updateProfileSchema,
  userProfileSchema,
  walletChallengeRequestSchema,
  walletChallengeSchema,
  walletSessionSchema,
  walletVerifyRequestSchema,
} from './schemas'

/** Мок грузится отдельным чанком и только в режиме VITE_AUTH_MOCK. */
const loadMock = async (): Promise<(typeof import('../mock/auth'))['mockAuthBackend']> =>
  (await import('../mock/auth')).mockAuthBackend

/** Эндпоинты входа ходят без Bearer и без повтора после 401 — токена у них ещё нет */
const NO_AUTH = { auth: false } as const

/** Шаг 1: получить от бэкенда транзакцию-вызов для подписи. */
export const requestWalletChallenge = async (
  input: WalletChallengeRequest,
): Promise<WalletChallenge> => {
  const body = walletChallengeRequestSchema.parse(input)
  const response = env.AUTH_MOCK
    ? await (await loadMock()).createChallenge(body)
    : await api.post<unknown>('/auth/wallet/challenge', body, NO_AUTH)
  return walletChallengeSchema.parse(response)
}

/** Шаг 2: отдать подписанную транзакцию. Access-токен — в ответе, refresh бэкенд ставит в cookie. */
export const verifyWalletChallenge = async (input: WalletVerifyRequest): Promise<WalletSession> => {
  const body = walletVerifyRequestSchema.parse(input)
  const response = env.AUTH_MOCK
    ? await (await loadMock()).verify(body)
    : await api.post<unknown>('/auth/wallet/verify', body, NO_AUTH)
  return walletSessionSchema.parse(response)
}

/**
 * Новый access-токен по refresh-cookie. Refresh-токены одноразовые: два параллельных
 * обновления с одной cookie бэкенд примет за кражу и отзовёт сессию. Поэтому обновления
 * идут по одному — и в этой вкладке, и между вкладками (Web Locks): вторая вкладка
 * отправит уже новую cookie, которую получила первая.
 */
let inFlight: Promise<AccessToken> | null = null

const refreshNow = async (): Promise<AccessToken> => {
  const response = env.AUTH_MOCK
    ? await (await loadMock()).refresh()
    : await api.post<unknown>('/auth/refresh', undefined, NO_AUTH)
  return accessTokenSchema.parse(response)
}

export const refreshAccessToken = (): Promise<AccessToken> => {
  inFlight ??= (
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('divra.auth-refresh', refreshNow)
      : refreshNow()
  ).finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Выход с этого устройства: бэкенд отзывает refresh-токен и стирает cookie. */
export const signOutSession = async (): Promise<void> => {
  if (env.AUTH_MOCK) {
    ;(await loadMock()).signOut()
    return
  }
  await api.post<unknown>('/auth/sign-out', undefined, NO_AUTH)
}

/** Профиль по access-токену — проверка, что JWT работает с API. */
export const getMe = async (): Promise<UserProfile> => {
  const response = env.AUTH_MOCK ? await (await loadMock()).me() : await api.get<unknown>('/me')
  return userProfileSchema.parse(response)
}

/** Имя профиля: им ты входишь в новые группы, оно заменяет короткий адрес в старых */
export const updateProfile = async (input: {
  displayName?: string
  detectTransfers?: boolean
}): Promise<UserProfile> => {
  const body = updateProfileSchema.parse(input)
  const response = env.AUTH_MOCK
    ? await (await loadMock()).updateProfile(body)
    : await api.patch<unknown>('/me', body)
  return userProfileSchema.parse(response)
}

/**
 * Удалить аккаунт: кошельки и все сессии. В группах остаёшься участником без кошелька —
 * расходы и долги других не ломаются. Бэкенд заодно стирает refresh-cookie.
 */
export const deleteAccount = async (): Promise<void> => {
  if (env.AUTH_MOCK) {
    ;(await loadMock()).deleteAccount()
    return
  }
  await api.delete<unknown>('/me')
}

export const authKeys = {
  all: ['auth'] as const,
  challenge: (chain: string, address: string) =>
    [...authKeys.all, 'wallet-challenge', chain, address] as const,
  me: () => [...authKeys.all, 'me'] as const,
}
