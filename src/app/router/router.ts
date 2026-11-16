import { ErrorPage } from '@/pages/error'
import { HomePage } from '@/pages/home'
import { NotFoundPage } from '@/pages/not-found'
import { createBrowserRouter } from 'react-router'

export const router = createBrowserRouter([
  {
    path: '/',
    ErrorBoundary: ErrorPage,
    children: [
      { index: true, Component: HomePage },
      { path: '*', Component: NotFoundPage },
    ],
  },
])
