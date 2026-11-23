import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import {
  type UserProfile,
  apiErrorMessage,
  authKeys,
  transferKeys,
  updateProfile,
} from '@/shared/api'
import { Checkbox } from '@/shared/ui'

/**
 * «Замечать переводы мимо Divra»: бэкенд следит за токен-аккаунтами кошелька в потоке
 * LaserStream и подсказывает, когда участник общей группы перевёл тебе напрямую.
 * Выключил — кошелёк убирается из подписки.
 */
export const DetectTransfersToggle = ({ profile }: { profile: UserProfile }): ReactElement => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (detectTransfers: boolean) => updateProfile({ detectTransfers }),
    onSuccess: async (next) => {
      queryClient.setQueryData(authKeys.me(), next)
      await queryClient.invalidateQueries({ queryKey: transferKeys.all })
    },
  })
  const checked = mutation.isPending
    ? (mutation.variables ?? profile.detectTransfers)
    : profile.detectTransfers
  return (
    <>
      <label className="settings__toggle">
        <span className="settings__toggle-text">
          <span>Замечать переводы мимо Divra</span>
          <span className="settings__note">
            Если участник группы переведёт тебе USDC прямо из кошелька, предложим засчитать его в
            долг
          </span>
        </span>
        <Checkbox
          checked={checked}
          disabled={mutation.isPending}
          onChange={(event) => mutation.mutate(event.currentTarget.checked)}
        />
      </label>
      {mutation.error && (
        <p className="settings__hint settings__hint--error" role="alert">
          {apiErrorMessage(mutation.error, 'Не удалось сохранить настройку')}
        </p>
      )}
    </>
  )
}
