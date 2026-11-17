import { type UseMutationResult, useMutation } from '@tanstack/react-query'
import { useWalletSession } from '@/entities/wallet'
import type { WalletAccount, WalletAdapter } from '@/shared/lib/wallets'

/** Открывает окно расширения и кладёт аккаунт в сессию. */
export const useConnectWallet = (): UseMutationResult<WalletAccount, Error, WalletAdapter> =>
  useMutation({
    mutationKey: ['wallet', 'connect'],
    mutationFn: (adapter: WalletAdapter) => adapter.connect(),
    onMutate: (adapter) => {
      useWalletSession.getState().connectStarted(adapter.id)
    },
    onSuccess: (account, adapter) => {
      useWalletSession.getState().connected(adapter.id, account)
    },
    onError: () => {
      useWalletSession.getState().connectFailed()
    },
  })
