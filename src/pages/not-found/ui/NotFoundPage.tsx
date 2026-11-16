import type { ReactElement } from 'react'
import { Link } from 'react-router'

export const NotFoundPage = (): ReactElement => {
  return (
    <main>
      <h1>404</h1>
      <p>Страница не найдена</p>
      <Link to="/">На главную</Link>
    </main>
  )
}
