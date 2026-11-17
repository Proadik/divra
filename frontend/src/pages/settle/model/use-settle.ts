import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { usePreferences } from '@/entities/currency'
import { useWalletSession } from '@/entities/wallet'
import {
  type GroupMember,
  type GroupOverview,
  type SettlementResult,
  getGroupOverview,
  getWalletBalances,
  groupKeys,
  paymentKeys,
  prepareSettlement,
  submitSettlement,
} from '@/shared/api'
import { type Stablecoin, stablecoinMint } from '@/shared/config'
import { base64ToBytes, bytesToBase64 } from '@/shared/lib/encoding'
import { formatAmount } from '@/shared/lib/format'
import { type WalletAccount, WalletError, getWalletAdapter } from '@/shared/lib/wallets'
import { parseAmount, sanitizeAmount, toCents } from '../lib/amount-input'

export type SettleRow = {
  member: GroupMember
  /** Сколько ты должен, центы */
  owedCents: number
  selected: boolean
  amountText: string
  /** Сумма ввода больше долга */
  overpay: boolean
}

export type SettlePhase = 'idle' | 'preparing' | 'signing' | 'sending' | 'done'

type Draft = Record<string, { selected?: boolean; amountText?: string }>

export type Settle = {
  group: GroupOverview | undefined
  isLoading: boolean
  loadError: Error | null
  rows: SettleRow[]
  token: Stablecoin
  setToken: (token: Stablecoin) => void
  /** Сколько выбранного токена в кошельке; undefined — ещё не знаем */
  balance: number | undefined
  walletName: string | undefined
  account: WalletAccount | null
  totalCents: number
  selectedCount: number
  /** Почему нельзя отправить; null — можно */
  problem: string | null
  canSubmit: boolean
  toggle: (memberId: string, selected: boolean) => void
  setAmount: (memberId: string, text: string) => void
  start: () => void
  reset: () => void
  phase: SettlePhase
  result: SettlementResult | undefined
  error: Error | null
}

export const useSettle = (groupId: string): Settle => {
  const queryClient = useQueryClient()
  const account = useWalletSession((state) => state.account)
  const walletId = useWalletSession((state) => state.walletId)
  const preferredCoin = usePreferences((state) => state.stablecoin)
  const [token, setToken] = useState<Stablecoin>(preferredCoin)
  const [draft, setDraft] = useState<Draft>({})
  const [phase, setPhase] = useState<Exclude<SettlePhase, 'idle' | 'done'> | null>(null)

  const overview = useQuery({
    queryKey: groupKeys.overview(groupId),
    queryFn: () => getGroupOverview(groupId),
  })
  const balances = useQuery({
    queryKey: paymentKeys.balances(account?.address ?? ''),
    queryFn: () => getWalletBalances(account?.address ?? ''),
    enabled: account !== null,
  })

  const group = overview.data
  const me = group?.members.find((member) => member.isMe)
  // Кому ты должен: долги «от меня». Порядок — как в «Кто кому».
  const rows: SettleRow[] = (group?.debts ?? [])
    .filter((debt) => debt.fromId === me?.id)
    .flatMap((debt) => {
      const member = group?.members.find((item) => item.id === debt.toId)
      if (!member) {
        return []
      }
      const owedCents = toCents(debt.amount)
      const state = draft[member.id] ?? {}
      const amountText = state.amountText ?? formatAmount(debt.amount).replace(/\s/g, '')
      return [
        {
          member,
          owedCents,
          // Без кошелька перевести некуда — по умолчанию не выбираем
          selected: member.address ? (state.selected ?? true) : false,
          amountText,
          overpay: toCents(parseAmount(amountText)) > owedCents,
        },
      ]
    })

  const chosen = rows.filter((row) => row.selected && toCents(parseAmount(row.amountText)) > 0)
  const totalCents = chosen.reduce((sum, row) => sum + toCents(parseAmount(row.amountText)), 0)
  const balance = balances.data?.[token]

  const problem = ((): string | null => {
    if (!stablecoinMint(token)) {
      return `${token} нет в этой сети Solana — выбери другой стейблкоин`
    }
    if (rows.some((row) => row.selected && row.overpay)) {
      return 'Сумма больше долга'
    }
    if (balance !== undefined && totalCents > toCents(balance)) {
      return `Не хватает ${token}: в кошельке ${formatAmount(balance)}`
    }
    return null
  })()

  const settle = useMutation({
    mutationKey: ['settle', groupId],
    mutationFn: async (): Promise<SettlementResult> => {
      const adapter = walletId ? getWalletAdapter(walletId) : undefined
      if (!adapter || !account) {
        throw new WalletError('not-connected', 'Кошелёк не подключён')
      }
      setPhase('preparing')
      const prepared = await prepareSettlement(groupId, {
        token,
        payer: account.address,
        transfers: chosen.map((row) => ({
          memberId: row.member.id,
          amount: toCents(parseAmount(row.amountText)) / 100,
        })),
      })
      setPhase('signing')
      const { signedTransaction } = await adapter.sign({
        chain: prepared.chain,
        kind: 'transaction',
        transaction: base64ToBytes(prepared.transaction),
      })
      setPhase('sending')
      return submitSettlement(groupId, {
        settlementId: prepared.settlementId,
        signedTransaction: bytesToBase64(signedTransaction),
      })
    },
    onSuccess: async () => {
      // Долги закрыты: перечитать группу, главную и баланс кошелька
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: groupKeys.all }),
        queryClient.invalidateQueries({ queryKey: paymentKeys.all }),
      ])
    },
    // Ошибка тоже повод перечитать: «отправлено, ждём сеть» погасит долги чуть позже
    onError: () => queryClient.invalidateQueries({ queryKey: groupKeys.all }),
    onSettled: () => setPhase(null),
  })

  const update = (memberId: string, patch: { selected?: boolean; amountText?: string }): void =>
    setDraft((prev) => ({ ...prev, [memberId]: { ...prev[memberId], ...patch } }))

  return {
    group,
    isLoading: overview.isPending,
    loadError: overview.error,
    rows,
    token,
    setToken,
    balance,
    walletName: walletId ? getWalletAdapter(walletId)?.name : undefined,
    account,
    totalCents,
    selectedCount: chosen.length,
    problem,
    canSubmit: chosen.length > 0 && problem === null && !settle.isPending,
    toggle: (memberId: string, selected: boolean) => update(memberId, { selected }),
    setAmount: (memberId: string, text: string) =>
      update(memberId, { amountText: sanitizeAmount(text) }),
    start: () => settle.mutate(),
    reset: () => settle.reset(),
    phase: settle.isSuccess ? 'done' : (phase ?? 'idle'),
    result: settle.data,
    error: settle.error,
  }
}
