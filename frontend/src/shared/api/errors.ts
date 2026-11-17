import { ApiError } from './client'

/** Текст ошибки для пользователя: message из ответа сервера или запасной вариант. */
export const apiErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    const message = (error.data as { message?: unknown } | null)?.message
    if (typeof message === 'string' && message) {
      return message
    }
  }
  return fallback
}
