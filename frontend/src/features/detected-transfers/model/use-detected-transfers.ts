import {
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  type AppliedTransfer,
  type DetectedTransfer,
  applyDetectedTransfer,
  dismissDetectedTransfer,
  getDetectedTransfers,
  groupKeys,
  transferKeys,
} from '@/shared/api'

export type DetectedTransfersModel = {
  items: DetectedTransfer[]
  apply: UseMutationResult<AppliedTransfer, Error, { id: string; groupId: string }>
  dismiss: UseMutationResult<void, Error, string>
}

/**
 * Подсказки «перевод мимо Divra». Обновляются событием `transfer.detected` (WebSocket),
 * а на случай, если событие не дошло, — раз в минуту.
 */
export const useDetectedTransfers = (): DetectedTransfersModel => {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: transferKeys.all,
    queryFn: getDetectedTransfers,
    refetchInterval: 60_000,
  })
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: transferKeys.all }),
      queryClient.invalidateQueries({ queryKey: groupKeys.all }),
    ])
  }
  const apply = useMutation({
    mutationFn: ({ id, groupId }: { id: string; groupId: string }) =>
      applyDetectedTransfer(id, groupId),
    onSuccess: refresh,
  })
  const dismiss = useMutation({
    mutationFn: dismissDetectedTransfer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: transferKeys.all }),
  })
  return { items: query.data ?? [], apply, dismiss }
}
