import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query'
import { useWalletSession } from '@/entities/wallet'
import { deleteAccount } from '@/shared/api'
import { getWalletAdapter } from '@/shared/lib/wallets'

/**
 * Удаление аккаунта: бэкенд стирает кошельки и все сессии (и refresh-cookie). После этого
 * чистим сессию и весь кэш и отключаем кошелёк — как при выходе, но без возврата.
 */
export const useDeleteAccount = (): UseMutationResult<void, Error, void> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['account', 'delete'],
    mutationFn: deleteAccount,
    onSuccess: async () => {
      const { walletId, reset } = useWalletSession.getState()
      reset()
      queryClient.clear()
      await (walletId ? getWalletAdapter(walletId)?.disconnect() : undefined)
    },
  })
}
