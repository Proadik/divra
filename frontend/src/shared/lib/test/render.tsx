import type { ReactElement } from 'react'
import { type RenderResult, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import userEvent, { type UserEvent } from '@testing-library/user-event'

type RenderWithRouterOptions = {
  route?: string
}

export const renderWithRouter = (
  ui: ReactElement,
  { route = '/' }: RenderWithRouterOptions = {},
): RenderResult & { user: UserEvent } => {
  return {
    user: userEvent.setup(),
    ...render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>),
  }
}
