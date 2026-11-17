import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactElement, useState } from 'react'
import { addMember, addMemberRequestSchema, apiErrorMessage, groupKeys } from '@/shared/api'
import { Button, TextField } from '@/shared/ui'

export const AddByNameForm = ({ groupId }: { groupId: string }): ReactElement => {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const parsed = addMemberRequestSchema.safeParse({ displayName: name })

  const add = useMutation({
    mutationFn: (displayName: string) => addMember(groupId, { displayName }),
    onSuccess: async () => {
      setName('')
      setTouched(false)
      await queryClient.invalidateQueries({ queryKey: groupKeys.all })
    },
  })

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setTouched(true)
    if (parsed.success && !add.isPending) {
      add.mutate(parsed.data.displayName)
    }
  }

  const error = add.error
    ? apiErrorMessage(add.error, 'Не удалось добавить участника')
    : touched && !parsed.success
      ? (parsed.error.issues[0]?.message ?? null)
      : null

  return (
    <form className="members__add" onSubmit={submit} noValidate>
      <div className="sp-listgroup">
        <TextField
          label="Имя"
          placeholder="Например, Ержан"
          value={name}
          maxLength={32}
          autoComplete="off"
          aria-invalid={error !== null}
          onChange={(event) => {
            setName(event.currentTarget.value)
            add.reset()
          }}
        />
      </div>
      {error && (
        <p className="members__error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" icon="plus" block disabled={add.isPending}>
        {add.isPending ? 'Добавляем…' : 'Добавить в группу'}
      </Button>
    </form>
  )
}
