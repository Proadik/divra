import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useWalletSession } from '@/entities/wallet'
import {
  type WalletChallenge,
  authKeys,
  requestWalletChallenge,
  verifyWalletChallenge,
} from '@/shared/api'
import { base64ToBytes, bytesToBase64 } from '@/shared/lib/encoding'
import { type WalletAccount, WalletError, getWalletAdapter } from '@/shared/lib/wallets'

export type VerifyPhase = 'loading' | 'ready' | 'signing' | 'verifying' | 'done'

export type VerifyWallet = {
  account: WalletAccount | null
  challenge: UseQueryResult<WalletChallenge>
  confirm: () => void
  error: Error | null
  phase: VerifyPhase
  isBusy: boolean
}

/**
 * Подтверждение владения кошельком:
 * бэкенд выдаёт транзакцию → кошелёк её подписывает → бэкенд проверяет подпись и выдаёт сессию.
 */
export const useVerifyWallet = (): VerifyWallet => {
  const queryClient = useQueryClient()
  const walletId = useWalletSession((state) => state.walletId)
  const account = useWalletSession((state) => state.account)
  const [phase, setPhase] = useState<'signing' | 'verifying' | null>(null)

  const challengeKey = authKeys.challenge(account?.chain ?? '', account?.address ?? '')

  const challenge = useQuery({
    queryKey: challengeKey,
    queryFn: () => {
      if (!account) {
        throw new WalletError('not-connected', 'Кошелёк не подключён')
      }
      return requestWalletChallenge({ chain: account.chain, address: account.address })
    },
    enabled: account !== null,
    // Вызов одноразовый и живёт 5 минут — не перезапрашиваем сами, только после ошибки
    staleTime: Infinity,
    gcTime: 0,
    retry: 1,
  })

  const confirm = useMutation({
    mutationKey: ['wallet', 'verify'],
    mutationFn: async (payload: WalletChallenge) => {
      const adapter = walletId ? getWalletAdapter(walletId) : undefined
      if (!adapter || !account) {
        throw new WalletError('not-connected', 'Кошелёк не подключён')
      }
      setPhase('signing')
      const { signedTransaction } = await adapter.sign({
        chain: payload.chain,
        kind: 'transaction',
        transaction: base64ToBytes(payload.transaction),
      })
      setPhase('verifying')
      return verifyWalletChallenge({
        challengeId: payload.challengeId,
        chain: account.chain,
        address: account.address,
        signedPayload: bytesToBase64(signedTransaction),
      })
    },
    onSuccess: (session) => {
      useWalletSession.getState().verified(session.accessToken)
      // Новый пользователь — свежий профиль
      void queryClient.invalidateQueries({ queryKey: authKeys.me() })
    },
    onError: () => {
      // Вызов одноразовый: после любой ошибки берём новый
      void queryClient.invalidateQueries({ queryKey: challengeKey })
    },
    onSettled: () => setPhase(null),
  })

  const currentPhase: VerifyPhase = confirm.isSuccess
    ? 'done'
    : (phase ?? (challenge.data ? 'ready' : 'loading'))

  return {
    account,
    challenge,
    confirm: (): void => {
      if (challenge.data) {
        confirm.mutate(challenge.data)
      }
    },
    error: confirm.error ?? challenge.error,
    phase: currentPhase,
    isBusy: confirm.isPending || challenge.isFetching,
  }
}
