import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactElement, useState } from 'react'
import {
  type UserProfile,
  apiErrorMessage,
  authKeys,
  groupKeys,
  updateProfile,
  updateProfileSchema,
} from '@/shared/api'
import { Button, TextField } from '@/shared/ui'

/**
 * Имя профиля. Им ты входишь в новые группы; в старых оно заменяет короткий адрес
 * (имя, которое кто-то задал тебе вручную, бэкенд не трогает).
 */
export const ProfileNameForm = ({ profile }: { profile: UserProfile }): ReactElement => {
  const queryClient = useQueryClient()
  const [name, setName] = useState(profile.displayName ?? '')
  const [saved, setSaved] = useState(false)
  const parsed = updateProfileSchema.safeParse({ displayName: name })
  const unchanged = name.trim() === (profile.displayName ?? '')
  const mutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: async (next) => {
      queryClient.setQueryData(authKeys.me(), next)
      await queryClient.invalidateQueries({ queryKey: groupKeys.all })
      setSaved(true)
    },
  })
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (parsed.success && !unchanged) {
      mutation.mutate(parsed.data)
    }
  }

  return (
    <form className="settings__profile" onSubmit={submit}>
      <TextField
        label="Как тебя зовут"
        placeholder="Например, Адиль"
        value={name}
        maxLength={32}
        autoComplete="nickname"
        onChange={(event) => {
          setName(event.currentTarget.value)
          setSaved(false)
        }}
      />
      <Button
        type="submit"
        variant="secondary"
        disabled={!parsed.success || unchanged || mutation.isPending}
      >
        {mutation.isPending ? 'Сохраняем…' : saved && unchanged ? 'Сохранено' : 'Сохранить'}
      </Button>
      {mutation.error && (
        <p className="settings__hint settings__hint--error" role="alert">
          {apiErrorMessage(mutation.error, 'Не удалось сохранить имя')}
        </p>
      )}
    </form>
  )
}
