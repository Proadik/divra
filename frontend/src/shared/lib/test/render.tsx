import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type RenderResult, render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import userEvent, { type UserEvent } from '@testing-library/user-event'

type RenderWithRouterOptions = {
  route?: string
  /** Шаблон маршрута, если странице нужны параметры: `/groups/:groupId` */
  path?: string
}

export const renderWithRouter = (
  ui: ReactElement,
  { route = '/', path }: RenderWithRouterOptions = {},
): RenderResult & { user: UserEvent } => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          {path ? (
            <Routes>
              <Route path={path} element={ui} />
            </Routes>
          ) : (
            ui
          )}
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}
