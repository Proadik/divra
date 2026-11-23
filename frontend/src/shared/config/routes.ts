/** Пути приложения. Общие для роутера (app) и навигации со страниц. */
export const ROUTES = {
  connect: '/connect',
  verify: '/verify',
  /** Обзор: общий баланс, список групп, недавнее */
  home: '/',
  group: '/groups/:groupId',
  addExpense: '/groups/:groupId/expenses/new',
  /** Правка расхода — та же форма, что и для нового */
  editExpense: '/groups/:groupId/expenses/:expenseId/edit',
  members: '/groups/:groupId/members',
  /** Перевести долги стейблкоином */
  settle: '/groups/:groupId/settle',
  /** Попросить должников вернуть деньги */
  request: '/groups/:groupId/request',
  /** Публичная страница запроса: её открывает друг по ссылке */
  payRequest: '/r/:code',
  join: '/join/:code',
  settings: '/settings',
  /** Все переводы в сети с твоим участием */
  history: '/history',
} as const

const id = (value: string): string => encodeURIComponent(value)

export const groupPath = (groupId: string): string => `/groups/${id(groupId)}`
export const addExpensePath = (groupId: string): string => `${groupPath(groupId)}/expenses/new`
export const editExpensePath = (groupId: string, expenseId: string): string =>
  `${groupPath(groupId)}/expenses/${id(expenseId)}/edit`
export const membersPath = (groupId: string): string => `${groupPath(groupId)}/members`
export const joinPath = (code: string): string => `/join/${id(code)}`
export const settlePath = (groupId: string): string => `${groupPath(groupId)}/settle`
export const requestPath = (groupId: string): string => `${groupPath(groupId)}/request`
export const payRequestPath = (code: string): string => `/r/${id(code)}`
