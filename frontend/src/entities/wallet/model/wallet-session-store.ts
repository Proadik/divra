import { z } from 'zod'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { chainIdSchema } from '@/shared/config'
import type { WalletAccount } from '@/shared/lib/wallets'

/**
 * disconnected → connecting → connected → verified
 * restoring — после перезагрузки, пока тихо переподключаемся к расширению.
 */
export type WalletSessionStatus =
  | 'disconnected'
  | 'restoring'
  | 'connecting'
  | 'connected'
  | 'verified'

/**
 * Пояснение на экране подтверждения:
 * account-changed — аккаунт сменился до того, как его подтвердили;
 * session-expired — refresh-токен истёк или отозван, нужно подписать заново.
 */
export type WalletSessionNotice = 'account-changed' | 'session-expired' | null

/**
 * Расхождение сессии и расширения:
 * wallet-disconnected — расширение не отдаёт аккаунт (отозван доступ, кошелёк заблокирован);
 * other-account — в расширении выбран не тот аккаунт, на который выдана сессия.
 */
export type WalletMismatch = 'wallet-disconnected' | 'other-account' | null

type WalletSessionState = {
  status: WalletSessionStatus
  walletId: string | null
  /** Аккаунт сессии: на него выдан токен, им подписываются операции */
  account: WalletAccount | null
  /** Аккаунт, выбранный в расширении прямо сейчас. Не сохраняется между перезагрузками. */
  walletAccount: WalletAccount | null
  /**
   * Access-токен (JWT). Только в памяти вкладки: localStorage читает любой скрипт на странице.
   * После перезагрузки его заново выдаёт бэкенд по HttpOnly refresh-cookie.
   */
  sessionToken: string | null
  /** Вход был — после перезагрузки стоит попробовать обновить токен. Сохраняется. */
  signedIn: boolean
  notice: WalletSessionNotice
}

type WalletSessionActions = {
  connectStarted: (walletId: string) => void
  connected: (walletId: string, account: WalletAccount) => void
  connectFailed: () => void
  verified: (sessionToken: string) => void
  /** Токен обновлён по refresh-cookie */
  tokenRefreshed: (sessionToken: string) => void
  /** Refresh не удался (истёк, отозван, украден): возвращаемся к подписи */
  sessionExpired: () => void
  /**
   * Событие из расширения. Из сессии НЕ выкидывает: подтверждённая сессия остаётся,
   * меняется только walletAccount, а UI показывает плашку и просит переключиться перед подписью.
   */
  accountChanged: (account: WalletAccount | null) => void
  /** После перезагрузки: кошелёк переподключился; token — обновлённый access-токен или null */
  restored: (account: WalletAccount, sessionToken: string | null) => void
  /** Кошелёк не переподключился; с токеном сессия остаётся, кошелёк помечен отключённым */
  restoreFailed: (sessionToken: string | null) => void
  /** Пользователь сам решил войти аккаунтом, выбранным в расширении: нужна новая подпись */
  switchToWalletAccount: () => void
  reset: () => void
}

export type WalletSessionStore = WalletSessionState & WalletSessionActions

const initialState: WalletSessionState = {
  status: 'disconnected',
  walletId: null,
  account: null,
  walletAccount: null,
  sessionToken: null,
  signedIn: false,
  notice: null,
}

const sameAccount = (a: WalletAccount | null, b: WalletAccount | null): boolean =>
  a !== null && b !== null && a.address === b.address && a.chain === b.chain

/** Есть ли расхождение, из-за которого нельзя подписывать от имени сессии. */
export const selectWalletMismatch = (state: WalletSessionState): WalletMismatch => {
  if (state.status !== 'verified' && state.status !== 'connected') {
    return null
  }
  if (!state.walletAccount) {
    return 'wallet-disconnected'
  }
  return sameAccount(state.walletAccount, state.account) ? null : 'other-account'
}

/** То, что хранится в localStorage. Проверяется zod при чтении — мусор не попадёт в стор. */
const persistedSchema = z.object({
  walletId: z.string().min(1),
  account: z.object({ chain: chainIdSchema, address: z.string().min(1) }),
  signedIn: z.boolean().optional(),
  /** Старый формат хранил сам токен — теперь только признак входа */
  sessionToken: z.string().nullable().optional(),
})

const STORAGE_KEY = 'divra.wallet-session'

export const useWalletSession = create<WalletSessionStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      connectStarted: (walletId) => set({ ...initialState, status: 'connecting', walletId }),

      connected: (walletId, account) =>
        set({
          status: 'connected',
          walletId,
          account,
          walletAccount: account,
          sessionToken: null,
          notice: null,
        }),

      connectFailed: () => set(initialState),

      verified: (sessionToken) =>
        set({ status: 'verified', sessionToken, signedIn: true, notice: null }),

      tokenRefreshed: (sessionToken) => set({ sessionToken }),

      sessionExpired: () => {
        if (get().status !== 'verified') {
          return
        }
        set({ status: 'connected', sessionToken: null, signedIn: false, notice: 'session-expired' })
      },

      accountChanged: (account) => {
        const { status, account: current } = get()
        if (status === 'verified') {
          set({ walletAccount: account })
          return
        }
        if (status === 'connected') {
          // Ещё не подтверждён — просто подтверждаем тот аккаунт, что выбран в расширении
          if (!account) {
            set({ walletAccount: null })
            return
          }
          set({
            account,
            walletAccount: account,
            notice: sameAccount(account, current) ? get().notice : 'account-changed',
          })
        }
      },

      restored: (account, sessionToken) => {
        const { account: saved, signedIn } = get()
        if (sessionToken) {
          set({ status: 'verified', walletAccount: account, sessionToken, signedIn: true })
          return
        }
        set({
          status: 'connected',
          account,
          walletAccount: account,
          signedIn: false,
          notice: signedIn
            ? 'session-expired'
            : sameAccount(account, saved)
              ? null
              : 'account-changed',
        })
      },

      restoreFailed: (sessionToken) => {
        if (sessionToken) {
          set({ status: 'verified', walletAccount: null, sessionToken, signedIn: true })
          return
        }
        set(initialState)
      },

      switchToWalletAccount: () => {
        const { walletAccount } = get()
        if (!walletAccount) {
          return
        }
        set({
          status: 'connected',
          account: walletAccount,
          sessionToken: null,
          signedIn: false,
          notice: 'account-changed',
        })
      },

      reset: () => set(initialState),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Токен не сохраняем — только признак, что вход был
      partialize: ({ walletId, account, signedIn }) => ({ walletId, account, signedIn }),
      merge: (persisted, current) => {
        const parsed = persistedSchema.safeParse(persisted)
        if (!parsed.success) {
          return current
        }
        const { walletId, account, signedIn, sessionToken } = parsed.data
        return {
          ...current,
          walletId,
          account,
          signedIn: signedIn ?? Boolean(sessionToken),
          status: 'restoring',
        }
      },
    },
  ),
)
