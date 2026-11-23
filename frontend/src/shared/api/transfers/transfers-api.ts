import { z } from 'zod'
import { env } from '@/shared/config'
import { api } from '../client'
import {
  type AppliedTransfer,
  type DetectedTransfer,
  appliedTransferSchema,
  applyTransferRequestSchema,
  detectedTransferSchema,
} from './schemas'

const loadMock = async (): Promise<(typeof import('../mock/groups'))['mockGroupsBackend']> =>
  (await import('../mock/groups')).mockGroupsBackend

const transferPath = (id: string): string => `/detected-transfers/${encodeURIComponent(id)}`

/** Переводы мимо Divra, которые можно засчитать (только те, где отправитель ещё должен тебе) */
export const getDetectedTransfers = async (): Promise<DetectedTransfer[]> => {
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).getDetectedTransfers()
    : await api.get<unknown>('/me/detected-transfers')
  return z.array(detectedTransferSchema).parse(response)
}

/** Засчитать как возврат долга в группе. Бэкенд перепроверит транзакцию в сети */
export const applyDetectedTransfer = async (
  id: string,
  groupId: string,
): Promise<AppliedTransfer> => {
  const body = applyTransferRequestSchema.parse({ groupId })
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).applyDetectedTransfer(id, body.groupId)
    : await api.post<unknown>(`${transferPath(id)}/apply`, body)
  return appliedTransferSchema.parse(response)
}

/** «Это не за долг» — подсказка пропадает */
export const dismissDetectedTransfer = async (id: string): Promise<void> => {
  if (env.GROUPS_MOCK) {
    await (await loadMock()).dismissDetectedTransfer(id)
    return
  }
  await api.post<unknown>(`${transferPath(id)}/dismiss`)
}

/** Только для мока: «Тимур перевёл тебе из кошелька» — чтобы показать функцию без сети */
export const simulateDetectedTransfer = async (): Promise<void> => {
  await (await loadMock()).simulateDetectedTransfer()
}

export const transferKeys = {
  all: ['detected-transfers'] as const,
}
