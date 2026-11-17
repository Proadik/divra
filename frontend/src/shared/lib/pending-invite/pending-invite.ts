import { z } from 'zod'

/**
 * Код приглашения, по которому человек пришёл до входа.
 * Живёт в sessionStorage: переживает переход /connect → /verify, но не закрытие вкладки.
 */
const KEY = 'divra.pending-invite'
const codeSchema = z.string().regex(/^[\w-]{8,256}$/)

export const getPendingInvite = (): string | null => {
  try {
    const parsed = codeSchema.safeParse(sessionStorage.getItem(KEY))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const setPendingInvite = (code: string): void => {
  try {
    sessionStorage.setItem(KEY, code)
  } catch {
    // Приватный режим без storage — просто вернёмся на главную после входа
  }
}

export const clearPendingInvite = (): void => {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // нечего чистить
  }
}
