import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { usePreferences } from '@/entities/currency'
import { useWalletSession } from '@/entities/wallet'
import {
  type GroupMember,
  type GroupOverview,
  type PaymentRequest,
  type SentPaymentRequest,
  createPaymentRequests,
  getGroupOverview,
  getSentRequests,
  groupKeys,
  paymentKeys,
} from '@/shared/api'
import type { Stablecoin } from '@/shared/config'

export type RequestRow = {
  member: GroupMember
  amount: number
  selected: boolean
  /** Когда отправлен запрос, который ещё ждёт оплаты; null — такого нет */
  requestedAt: string | null
}

const REMIND_IN_DAYS = 3

export type RequestModel = {
  group: GroupOverview | undefined
  isLoading: boolean
  loadError: Error | null
  rows: RequestRow[]
  token: Stablecoin
  total: number
  selectedCount: number
  message: string
  setMessage: (message: string) => void
  remind: boolean
  setRemind: (remind: boolean) => void
  remindInDays: number
  toggle: (memberId: string, selected: boolean) => void
  submit: () => void
  isSubmitting: boolean
  error: Error | null
  /** Созданные запросы; undefined — ещё не создавали */
  requests: PaymentRequest[] | undefined
  /** Мои отправленные запросы в группе, новые сверху */
  sent: SentPaymentRequest[]
  /** Открытый заново запрос — снова показать ссылку и QR */
  reopened: SentPaymentRequest | null
  reopen: (request: SentPaymentRequest | null) => void
}

export const useRequest = (groupId: string): RequestModel => {
  const queryClient = useQueryClient()
  const account = useWalletSession((state) => state.account)
  const token = usePreferences((state) => state.stablecoin)
  const [unselected, setUnselected] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [remind, setRemind] = useState(true)
  const [reopened, setReopened] = useState<SentPaymentRequest | null>(null)

  const overview = useQuery({
    queryKey: groupKeys.overview(groupId),
    queryFn: () => getGroupOverview(groupId),
  })
  const sent = useQuery({
    queryKey: paymentKeys.sent(groupId),
    queryFn: () => getSentRequests(groupId),
  })

  const group = overview.data
  const me = group?.members.find((member) => member.isMe)
  const rows: RequestRow[] = (group?.debts ?? [])
    .filter((debt) => debt.toId === me?.id)
    .flatMap((debt): RequestRow[] => {
      const member = group?.members.find((item) => item.id === debt.fromId)
      if (!member) {
        return []
      }
      const requested = sent.data?.find(
        (item) => item.memberId === member.id && item.status === 'open',
      )
      return [
        {
          member,
          amount: debt.amount,
          selected: !unselected.has(member.id),
          requestedAt: requested?.createdAt ?? null,
        },
      ]
    })
  const chosen = rows.filter((row) => row.selected)
  const total = chosen.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100
  const text = message ?? (group ? `Привет! Скинься за «${group.name}»` : '')

  const create = useMutation({
    mutationKey: ['payment-requests', groupId],
    mutationFn: (): Promise<PaymentRequest[]> => {
      if (!account) {
        throw new Error('Кошелёк не подключён')
      }
      return createPaymentRequests(groupId, {
        token,
        recipient: account.address,
        memberIds: chosen.map((row) => row.member.id),
        message: text,
        remindInDays: remind ? REMIND_IN_DAYS : null,
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: paymentKeys.sent(groupId) }),
  })

  return {
    group,
    isLoading: overview.isPending,
    loadError: overview.error,
    rows,
    token,
    total,
    selectedCount: chosen.length,
    message: text,
    setMessage,
    remind,
    setRemind,
    remindInDays: REMIND_IN_DAYS,
    toggle: (memberId: string, selected: boolean) =>
      setUnselected((prev) => {
        const next = new Set(prev)
        if (selected) {
          next.delete(memberId)
        } else {
          next.add(memberId)
        }
        return next
      }),
    submit: () => create.mutate(),
    isSubmitting: create.isPending,
    error: create.error,
    requests: create.data,
    sent: sent.data ?? [],
    // Свежая версия из списка: после напоминания у запроса новая отметка remindedAt
    reopened: reopened
      ? (sent.data?.find((item) => item.code === reopened.code) ?? reopened)
      : null,
    reopen: setReopened,
  }
}
