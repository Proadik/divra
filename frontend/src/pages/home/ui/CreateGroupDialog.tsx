import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactElement, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  type GroupKind,
  apiErrorMessage,
  createGroup,
  createGroupRequestSchema,
  groupKeys,
} from '@/shared/api'
import { membersPath } from '@/shared/config'
import { Button, Modal, SegmentedControl, TextField } from '@/shared/ui'
import { GROUP_KIND_OPTIONS } from '../lib/groups'

type CreateGroupDialogProps = {
  open: boolean
  onClose: () => void
}

/** Новая группа: название и тип. После создания — сразу к участникам, позвать друзей. */
export const CreateGroupDialog = ({ open, onClose }: CreateGroupDialogProps): ReactElement => {
  const formId = useId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<GroupKind>('trip')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: createGroup,
    onSuccess: async (group) => {
      await queryClient.invalidateQueries({ queryKey: groupKeys.all })
      void navigate(membersPath(group.id))
    },
    onError: (cause) => setError(apiErrorMessage(cause, 'Не удалось создать группу')),
  })

  const close = (): void => {
    setError(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Новая группа"
      actions={
        <>
          <Button type="submit" form={formId} block disabled={create.isPending}>
            {create.isPending ? 'Создаём…' : 'Создать'}
          </Button>
          <Button variant="ghost" block onClick={close}>
            Отмена
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="home__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          const parsed = createGroupRequestSchema.safeParse({ name, kind })
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Проверь название')
            return
          }
          setError(null)
          create.mutate(parsed.data)
        }}
      >
        <div className="home__field">
          <TextField
            label="Название"
            placeholder="Поездка в горы"
            value={name}
            maxLength={40}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <SegmentedControl
          label="Тип группы"
          options={GROUP_KIND_OPTIONS}
          value={kind}
          onChange={setKind}
        />
        {error && (
          <p role="alert" className="home__error">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
