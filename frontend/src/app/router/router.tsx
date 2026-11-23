import { ConnectPage } from '@/pages/connect'
import { ErrorPage } from '@/pages/error'
import { GroupPage } from '@/pages/group'
import { HomePage } from '@/pages/home'
import { NotFoundPage } from '@/pages/not-found'
import { VerifyPage } from '@/pages/verify'
import { ROUTES } from '@/shared/config'
import { createBrowserRouter } from 'react-router'
import {
  LazyAddExpensePage,
  LazyHistoryPage,
  LazyJoinPage,
  LazyMembersPage,
  LazyPayRequestPage,
  LazyRequestPage,
  LazySettingsPage,
  LazySettlePage,
} from './lazy-pages'
import { AppLayout } from './AppLayout'
import { SessionGate } from './SessionGate'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    ErrorBoundary: ErrorPage,
    children: [
      {
        index: true,
        element: (
          <SessionGate access="verified">
            <HomePage />
          </SessionGate>
        ),
      },
      {
        path: ROUTES.group,
        element: (
          <SessionGate access="verified">
            <GroupPage />
          </SessionGate>
        ),
      },
      {
        path: ROUTES.addExpense,
        element: (
          <SessionGate access="verified">
            <LazyAddExpensePage />
          </SessionGate>
        ),
      },
      {
        path: ROUTES.editExpense,
        element: (
          <SessionGate access="verified">
            <LazyAddExpensePage />
          </SessionGate>
        ),
      },
      {
        path: ROUTES.members,
        element: (
          <SessionGate access="verified">
            <LazyMembersPage />
          </SessionGate>
        ),
      },
      {
        path: ROUTES.settle,
        element: (
          <SessionGate access="verified">
            <LazySettlePage />
          </SessionGate>
        ),
      },
      {
        path: ROUTES.request,
        element: (
          <SessionGate access="verified">
            <LazyRequestPage />
          </SessionGate>
        ),
      },
      {
        // Друг открывает без входа
        path: ROUTES.payRequest,
        element: (
          <SessionGate access="any">
            <LazyPayRequestPage />
          </SessionGate>
        ),
      },
      {
        path: ROUTES.history,
        element: (
          <SessionGate access="verified">
            <LazyHistoryPage />
          </SessionGate>
        ),
      },
      {
        path: ROUTES.settings,
        element: (
          <SessionGate access="verified">
            <LazySettingsPage />
          </SessionGate>
        ),
      },
      {
        path: ROUTES.join,
        element: (
          <SessionGate access="any">
            <LazyJoinPage />
          </SessionGate>
        ),
      },
      {
        path: ROUTES.connect,
        element: (
          <SessionGate access="guest">
            <ConnectPage />
          </SessionGate>
        ),
      },
      {
        path: ROUTES.verify,
        element: (
          <SessionGate access="unverified">
            <VerifyPage />
          </SessionGate>
        ),
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
])
