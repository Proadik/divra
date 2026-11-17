export type WalletErrorCode =
  | 'not-installed'
  | 'rejected'
  | 'no-account'
  | 'unsupported'
  | 'not-connected'
  | 'unknown'

export class WalletError extends Error {
  readonly code: WalletErrorCode

  constructor(code: WalletErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WalletError'
    this.code = code
  }
}

const REJECTION_CODES = new Set([4001, 'ACTION_REJECTED'])

/** Приводит ошибку любого кошелька к WalletError. Отказ пользователя — отдельный код. */
export const toWalletError = (error: unknown): WalletError => {
  if (error instanceof WalletError) {
    return error
  }
  const code = (error as { code?: unknown } | null)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (REJECTION_CODES.has(code as number | string) || /reject|denied|cancel/i.test(message)) {
    return new WalletError('rejected', 'Запрос отклонён в кошельке', { cause: error })
  }
  return new WalletError('unknown', message || 'Ошибка кошелька', { cause: error })
}

const MESSAGES: Record<WalletErrorCode, string> = {
  'not-installed': 'Расширение кошелька не найдено',
  rejected: 'Запрос отклонён в кошельке',
  'no-account': 'В кошельке нет подходящего аккаунта',
  unsupported: 'Кошелёк не поддерживает это действие',
  'not-connected': 'Кошелёк не подключён',
  unknown: 'Не удалось связаться с кошельком',
}

export const walletErrorMessage = (error: unknown): string => MESSAGES[toWalletError(error).code]
