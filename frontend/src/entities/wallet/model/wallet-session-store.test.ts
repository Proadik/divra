import { selectWalletMismatch, useWalletSession } from './wallet-session-store'
import { beforeEach, describe, expect, it } from 'vitest'

const A = { chain: 'solana', address: 'AAAA1111' } as const
const B = { chain: 'solana', address: 'BBBB2222' } as const

const state = (): ReturnType<typeof useWalletSession.getState> => useWalletSession.getState()

describe('wallet session store', () => {
  beforeEach(() => {
    state().reset()
  })

  it('проходит путь connecting → connected → verified', () => {
    state().connectStarted('solana:phantom')
    expect(state().status).toBe('connecting')
    state().connected('solana:phantom', A)
    expect(state().status).toBe('connected')
    state().verified('token')
    expect(state()).toMatchObject({ status: 'verified', sessionToken: 'token' })
    expect(selectWalletMismatch(state())).toBeNull()
  })

  it('смена аккаунта после подтверждения не разлогинивает, а помечает расхождение', () => {
    state().connected('solana:phantom', A)
    state().verified('token')

    state().accountChanged(B)

    expect(state()).toMatchObject({
      status: 'verified',
      account: A,
      walletAccount: B,
      sessionToken: 'token',
    })
    expect(selectWalletMismatch(state())).toBe('other-account')

    state().accountChanged(A)
    expect(selectWalletMismatch(state())).toBeNull()
  })

  it('отзыв доступа не разлогинивает, а помечает кошелёк отключённым', () => {
    state().connected('solana:phantom', A)
    state().verified('token')

    state().accountChanged(null)

    expect(state()).toMatchObject({
      status: 'verified',
      sessionToken: 'token',
      walletAccount: null,
    })
    expect(selectWalletMismatch(state())).toBe('wallet-disconnected')
  })

  it('до подтверждения следует за аккаунтом расширения', () => {
    state().connected('solana:phantom', A)

    state().accountChanged(B)

    expect(state()).toMatchObject({ status: 'connected', account: B, notice: 'account-changed' })
  })

  it('по выбору пользователя переходит на аккаунт расширения с новой подписью', () => {
    state().connected('solana:phantom', A)
    state().verified('token')
    state().accountChanged(B)

    state().switchToWalletAccount()

    expect(state()).toMatchObject({ status: 'connected', account: B, sessionToken: null })
  })

  it('после перезагрузки без расширения сессия остаётся, кошелёк — отключён', () => {
    state().connected('solana:phantom', A)
    state().verified('token')

    state().restoreFailed('fresh-token')

    expect(state()).toMatchObject({
      status: 'verified',
      walletAccount: null,
      sessionToken: 'fresh-token',
    })
  })

  it('токен не сохраняется в localStorage — только признак входа', () => {
    state().connected('solana:phantom', A)
    state().verified('secret.jwt.token')

    const saved = localStorage.getItem('divra.wallet-session') ?? ''
    expect(saved).not.toContain('secret.jwt.token')
    expect(JSON.parse(saved).state).toMatchObject({ signedIn: true, account: A })
  })

  it('после перезагрузки: refresh удался — снова verified, не удался — подпись заново', () => {
    state().connected('solana:phantom', A)
    state().verified('token')

    state().restored(A, 'new-token')
    expect(state()).toMatchObject({ status: 'verified', sessionToken: 'new-token' })

    state().restored(A, null)
    expect(state()).toMatchObject({
      status: 'connected',
      notice: 'session-expired',
      signedIn: false,
    })
  })

  it('истёкшая сессия возвращает к подписи', () => {
    state().connected('solana:phantom', A)
    state().verified('token')

    state().sessionExpired()

    expect(state()).toMatchObject({
      status: 'connected',
      sessionToken: null,
      signedIn: false,
      notice: 'session-expired',
    })
  })

  it('игнорирует события, пока кошелёк не подключён', () => {
    state().accountChanged(B)
    expect(state().status).toBe('disconnected')
  })
})
