import type { ReactElement } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'

const getErrorMessage = (error: unknown): string => {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText}`
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Неизвестная ошибка'
}

export const ErrorPage = (): ReactElement => {
  const error = useRouteError()

  return (
    <main>
      <h1>Что-то пошло не так</h1>
      <p>{getErrorMessage(error)}</p>
      <button type="button" onClick={() => window.location.reload()}>
        Перезагрузить
      </button>
    </main>
  )
}
