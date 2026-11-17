import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { buildPaymentTransaction, paymentKeys, submitPayment } from '@/shared/api'
import { base64ToBytes, bytesToBase64 } from '@/shared/lib/encoding'
import { type WalletAdapter, toWalletError } from '@/shared/lib/wallets'

export type PayPhase = 'connecting' | 'preparing' | 'signing' | 'sending'

export type WalletPay = {
  /** Что происходит сейчас; null — ничего */
  phase: PayPhase | null
  /** Перевод ушёл в сеть, ждём, пока бэкенд найдёт его по reference */
  sent: boolean
  error: unknown
  pay: (adapter: WalletAdapter) => void
}

/**
 * Оплата прямо со страницы: расширение кошелька подключается, бэкенд собирает перевод
 * (сумма, получатель и reference — из запроса), кошелёк подписывает, бэкенд отправляет в сеть.
 * Расширения на компьютере не открывают ссылки solana:, поэтому одной ссылки мало.
 */
export const useWalletPay = (code: string): WalletPay => {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<PayPhase | null>(null)
  const mutation = useMutation({
    mutationKey: ['payments', 'pay', code],
    mutationFn: async (adapter: WalletAdapter) => {
      setPhase('connecting')
      const account = adapter.getAccount() ?? (await adapter.connect())
      setPhase('preparing')
      const prepared = await buildPaymentTransaction(code, account.address)
      setPhase('signing')
      const { signedTransaction } = await adapter
        .sign({
          chain: 'solana',
          kind: 'transaction',
          transaction: base64ToBytes(prepared.transaction),
        })
        .catch((error: unknown) => {
          throw toWalletError(error)
        })
      setPhase('sending')
      return submitPayment(code, bytesToBase64(signedTransaction))
    },
    // Сразу спросить статус: бэкенд проверит сеть при следующем обращении
    onSuccess: () => queryClient.invalidateQueries({ queryKey: paymentKeys.request(code) }),
    onSettled: () => setPhase(null),
  })
  return {
    phase,
    sent: mutation.isSuccess,
    error: mutation.error,
    pay: (adapter) => {
      if (!mutation.isPending) {
        mutation.mutate(adapter)
      }
    },
  }
}
