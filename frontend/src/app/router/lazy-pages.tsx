import { type ReactElement, Suspense, lazy } from 'react'

/*
 * Редкие страницы грузятся отдельными чанками: форма расхода (вместе с Maskito),
 * участники, приглашение, настройки, расчёты и запросы. Главная и вход от них не тяжелеют.
 */
const AddExpensePage = lazy(async () => ({
  default: (await import('@/pages/add-expense')).AddExpensePage,
}))
const MembersPage = lazy(async () => ({ default: (await import('@/pages/members')).MembersPage }))
const SettingsPage = lazy(async () => ({
  default: (await import('@/pages/settings')).SettingsPage,
}))
const SettlePage = lazy(async () => ({ default: (await import('@/pages/settle')).SettlePage }))
const RequestPage = lazy(async () => ({ default: (await import('@/pages/request')).RequestPage }))
const PayRequestPage = lazy(async () => ({
  default: (await import('@/pages/pay-request')).PayRequestPage,
}))
const JoinPage = lazy(async () => ({ default: (await import('@/pages/join')).JoinPage }))

export const LazyAddExpensePage = (): ReactElement => (
  <Suspense fallback={null}>
    <AddExpensePage />
  </Suspense>
)

export const LazyMembersPage = (): ReactElement => (
  <Suspense fallback={null}>
    <MembersPage />
  </Suspense>
)

export const LazyJoinPage = (): ReactElement => (
  <Suspense fallback={null}>
    <JoinPage />
  </Suspense>
)

export const LazySettingsPage = (): ReactElement => (
  <Suspense fallback={null}>
    <SettingsPage />
  </Suspense>
)

export const LazySettlePage = (): ReactElement => (
  <Suspense fallback={null}>
    <SettlePage />
  </Suspense>
)

export const LazyRequestPage = (): ReactElement => (
  <Suspense fallback={null}>
    <RequestPage />
  </Suspense>
)

export const LazyPayRequestPage = (): ReactElement => (
  <Suspense fallback={null}>
    <PayRequestPage />
  </Suspense>
)
