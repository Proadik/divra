import { z } from 'zod'
import { env } from '@/shared/config'
import { api } from '../client'
import {
  type CreatePaymentRequests,
  type PaymentRequest,
  type PaymentRequestPreview,
  type PaymentTransaction,
  type PrepareSettlementRequest,
  type PreparedSettlement,
  type SentPaymentRequest,
  type SettlementResult,
  type SubmitSettlementRequest,
  type WalletBalances,
  createPaymentRequestsSchema,
  paymentRequestPreviewSchema,
  paymentRequestSchema,
  paymentTransactionSchema,
  prepareSettlementRequestSchema,
  preparedSettlementSchema,
  sentPaymentRequestSchema,
  settlementResultSchema,
  submitSettlementRequestSchema,
  submittedPaymentSchema,
  walletBalancesSchema,
} from './schemas'

const loadMock = async (): Promise<(typeof import('../mock/groups'))['mockGroupsBackend']> =>
  (await import('../mock/groups')).mockGroupsBackend

const groupPath = (groupId: string): string => `/groups/${encodeURIComponent(groupId)}`

/**
 * Сколько USDC/USDT в кошельке. Бэкенд читает из сети (getTokenAccountsByOwner), только свои кошельки.
 * Платежи живут рядом с группами (VITE_GROUPS_MOCK): мок не знает групп бэкенда и наоборот.
 */
export const getWalletBalances = async (address: string): Promise<WalletBalances> => {
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).getWalletBalances(address)
    : await api.get<unknown>(`/wallets/${encodeURIComponent(address)}/balances`)
  return walletBalancesSchema.parse(response)
}

/** Шаг 1 «Рассчитаться»: бэкенд проверяет долги и собирает транзакцию. */
export const prepareSettlement = async (
  groupId: string,
  input: PrepareSettlementRequest,
): Promise<PreparedSettlement> => {
  const body = prepareSettlementRequestSchema.parse(input)
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).prepareSettlement(groupId, body)
    : await api.post<unknown>(`${groupPath(groupId)}/settlements`, body)
  return preparedSettlementSchema.parse(response)
}

/** Шаг 2: отдать подписанную транзакцию. Бэкенд отправляет её в сеть и ждёт подтверждения. */
export const submitSettlement = async (
  groupId: string,
  input: SubmitSettlementRequest,
): Promise<SettlementResult> => {
  const body = submitSettlementRequestSchema.parse(input)
  const path = `${groupPath(groupId)}/settlements/${encodeURIComponent(body.settlementId)}/submit`
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).submitSettlement(groupId, body)
    : await api.post<unknown>(path, body)
  return settlementResultSchema.parse(response)
}

/**
 * «Запросить»: по ссылке и QR на каждого выбранного должника.
 * Запросы живут рядом с группами (VITE_GROUPS_MOCK): мок не знает групп бэкенда и наоборот.
 */
export const createPaymentRequests = async (
  groupId: string,
  input: CreatePaymentRequests,
): Promise<PaymentRequest[]> => {
  const body = createPaymentRequestsSchema.parse(input)
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).createPaymentRequests(groupId, body)
    : await api.post<unknown>(`${groupPath(groupId)}/payment-requests`, body)
  return z.array(paymentRequestSchema).parse(response)
}

/** Публичная страница запроса — открывается без входа. */
export const getPaymentRequest = async (code: string): Promise<PaymentRequestPreview> => {
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).getPaymentRequest(code)
    : await api.get<unknown>(`/payment-requests/${encodeURIComponent(code)}`)
  return paymentRequestPreviewSchema.parse(response)
}

/** Оплата прямо со страницы запроса есть только с бэкендом: мок переводы в сеть не шлёт */
export const canPayFromPage = !env.GROUPS_MOCK

const requestPath = (code: string): string => `/payment-requests/${encodeURIComponent(code)}`

/**
 * Собрать перевод по запросу для кошелька плательщика. Сумму, получателя и reference
 * бэкенд берёт из запроса — от клиента только адрес кошелька.
 */
export const buildPaymentTransaction = async (
  code: string,
  account: string,
): Promise<PaymentTransaction> => {
  const response = await api.post<unknown>(
    `${requestPath(code)}/transaction`,
    { account },
    { auth: false },
  )
  return paymentTransactionSchema.parse(response)
}

/** Отправить подписанный перевод. Засчитает его бэкенд, когда найдёт в сети по reference. */
export const submitPayment = async (
  code: string,
  signedTransaction: string,
): Promise<{ signature: string }> => {
  const response = await api.post<unknown>(
    `${requestPath(code)}/submit`,
    { signedTransaction },
    { auth: false },
  )
  return submittedPaymentSchema.parse(response)
}

/** Мои запросы в группе, новые сверху: статус, ссылка, QR */
export const getSentRequests = async (groupId: string): Promise<SentPaymentRequest[]> => {
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).getSentRequests(groupId)
    : await api.get<unknown>(`${groupPath(groupId)}/payment-requests`)
  return z.array(sentPaymentRequestSchema).parse(response)
}

export const paymentKeys = {
  all: ['payments'] as const,
  balances: (address: string) => [...paymentKeys.all, 'balances', address] as const,
  request: (code: string) => [...paymentKeys.all, 'request', code] as const,
  sent: (groupId: string) => [...paymentKeys.all, 'sent', groupId] as const,
}
