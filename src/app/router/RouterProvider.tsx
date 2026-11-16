import type { ReactElement } from 'react'
import { RouterProvider as BaseRouterProvider } from 'react-router'
import { router } from './router'

export const RouterProvider = (): ReactElement => {
  return <BaseRouterProvider router={router} />
}
