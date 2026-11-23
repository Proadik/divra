import { env } from '@/shared/config'
import { api } from '../client'
import { type HistoryPage, historyPageSchema } from './schemas'

const loadMock = async (): Promise<(typeof import('../mock/groups'))['mockGroupsBackend']> =>
  (await import('../mock/groups')).mockGroupsBackend

/** Страница «Истории»: новые сверху. Без курсора — первая страница */
export const getHistory = async ({
  cursor,
  limit = 20,
}: { cursor?: string; limit?: number } = {}): Promise<HistoryPage> => {
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).getHistory(cursor, limit)
    : await api.get<unknown>('/me/history', { params: { cursor, limit } })
  return historyPageSchema.parse(response)
}

/** Сколько последних переводов на главной */
export const HISTORY_PREVIEW_LIMIT = 5

export const historyKeys = {
  all: ['history'] as const,
  preview: () => [...historyKeys.all, 'preview'] as const,
  list: () => [...historyKeys.all, 'list'] as const,
}
