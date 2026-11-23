import { env } from '@/shared/config'
import { api } from '../client'
import {
  type CreateExpenseRequest,
  type CreateGroupRequest,
  type ExpenseDetail,
  type GroupExpense,
  type GroupOverview,
  type GroupSummary,
  type HomeOverview,
  createExpenseRequestSchema,
  createGroupRequestSchema,
  expenseDetailSchema,
  expenseSchema,
  groupOverviewSchema,
  groupSummarySchema,
  homeOverviewSchema,
  removeMemberResponseSchema,
} from './schemas'

const loadMock = async (): Promise<(typeof import('../mock/groups'))['mockGroupsBackend']> =>
  (await import('../mock/groups')).mockGroupsBackend

/**
 * Себя в списках показываем как «Ты». Бэкенд отдаёт имя, под которым тебя видят другие
 * (по умолчанию короткий адрес) — его здесь подменяем только для тебя.
 */
const labelMe = (overview: GroupOverview): GroupOverview => ({
  ...overview,
  members: overview.members.map((member) => (member.isMe ? { ...member, name: 'Ты' } : member)),
})

/** Главная: итог по всем группам, список групп и недавние события. */
export const getHomeOverview = async (): Promise<HomeOverview> => {
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).getHome()
    : await api.get<unknown>('/me/overview')
  const home = homeOverviewSchema.parse(response)
  return {
    ...home,
    activity: home.activity.map((item) => ({
      ...item,
      actor: item.actor.isMe ? { ...item.actor, name: 'Ты' } : item.actor,
      counterpart: item.counterpart?.isMe ? { ...item.counterpart, name: 'Ты' } : item.counterpart,
    })),
  }
}

/** Новая группа, в ней пока только текущий пользователь. */
export const createGroup = async (input: CreateGroupRequest): Promise<GroupSummary> => {
  const body = createGroupRequestSchema.parse(input)
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).createGroup(body)
    : await api.post<unknown>('/groups', body)
  return groupSummarySchema.parse(response)
}

/** Сводка по одной группе: участники, баланс, кто кому, последние расходы. */
export const getGroupOverview = async (groupId: string): Promise<GroupOverview> => {
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).getOverview(groupId)
    : await api.get<unknown>(`/groups/${encodeURIComponent(groupId)}/overview`)
  return labelMe(groupOverviewSchema.parse(response))
}

/** Новый расход. Тело проверяется той же схемой, что и на бэкенде. */
export const createExpense = async (
  groupId: string,
  input: CreateExpenseRequest,
): Promise<GroupExpense> => {
  const body = createExpenseRequestSchema.parse(input)
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).createExpense(groupId, body)
    : await api.post<unknown>(`/groups/${encodeURIComponent(groupId)}/expenses`, body)
  return expenseSchema.parse(response)
}

const expensePath = (groupId: string, expenseId: string): string =>
  `/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`

/** Расход с долями — для формы правки. */
export const getExpense = async (groupId: string, expenseId: string): Promise<ExpenseDetail> => {
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).getExpense(groupId, expenseId)
    : await api.get<unknown>(expensePath(groupId, expenseId))
  return expenseDetailSchema.parse(response)
}

/** Заменить расход целиком. Править может автор или плательщик — проверяет бэкенд. */
export const updateExpense = async (
  groupId: string,
  expenseId: string,
  input: CreateExpenseRequest,
): Promise<GroupExpense> => {
  const body = createExpenseRequestSchema.parse(input)
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).updateExpense(groupId, expenseId, body)
    : await api.put<unknown>(expensePath(groupId, expenseId), body)
  return expenseSchema.parse(response)
}

export const deleteExpense = async (groupId: string, expenseId: string): Promise<void> => {
  if (env.GROUPS_MOCK) {
    await (await loadMock()).deleteExpense(groupId, expenseId)
    return
  }
  await api.delete<unknown>(expensePath(groupId, expenseId))
}

/**
 * Свой memberId — выйти из группы; чужой — удалить участника без кошелька.
 * Только без долгов: иначе 409.
 */
export const removeMember = async (
  groupId: string,
  memberId: string,
): Promise<{ left: boolean }> => {
  const path = `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).removeMember(groupId, memberId)
    : await api.delete<unknown>(path)
  return removeMemberResponseSchema.parse(response)
}

/** Только для мока: вернуть демо-данные к начальному состоянию. */
export const resetMockData = async (): Promise<void> => {
  const mock = await import('../mock/groups')
  mock.resetMockGroups()
}

export const groupKeys = {
  all: ['groups'] as const,
  home: () => [...groupKeys.all, 'home'] as const,
  overview: (groupId: string) => [...groupKeys.all, groupId, 'overview'] as const,
  expense: (groupId: string, expenseId: string) =>
    [...groupKeys.all, groupId, 'expenses', expenseId] as const,
}
