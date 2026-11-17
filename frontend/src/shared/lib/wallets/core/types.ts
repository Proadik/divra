import type { ChainId } from '@/shared/config'

/** Уникальный id адаптера: `<сеть>:<кошелёк>`, например `solana:phantom`. */
export type WalletId = `${ChainId}:${string}`

/** Аккаунт, с которым приложение работает сейчас. */
export type WalletAccount = {
  chain: ChainId
  address: string
}

/**
 * Что подписать. Формат зависит от сети, поэтому это размеченное объединение:
 * новая сеть добавляет свой вариант (ethereum → typed data, ton → BOC, tron → raw tx).
 */
export type SignRequest = {
  chain: 'solana'
  kind: 'transaction'
  /** Сериализованная транзакция (wire format) */
  transaction: Uint8Array
}

export type SignResult = {
  chain: 'solana'
  signedTransaction: Uint8Array
}

export type Unsubscribe = () => void

/**
 * Единый интерфейс кошелька для всех сетей.
 * Один адаптер = один кошелёк в одной сети = один файл (`solana/phantom.ts`).
 */
export type WalletAdapter = {
  readonly id: WalletId
  readonly chain: ChainId
  readonly name: string
  /** Куда отправить пользователя, если расширения нет */
  readonly installUrl: string
  /** Иконка, которую отдаёт само расширение (data URI). undefined — расширение не найдено. */
  getIcon(): string | undefined
  isInstalled(): boolean
  /** silent — восстановить уже выданный доступ без окна кошелька */
  connect(options?: { silent?: boolean }): Promise<WalletAccount>
  disconnect(): Promise<void>
  getAccount(): WalletAccount | null
  sign(request: SignRequest): Promise<SignResult>
  /**
   * Смена аккаунта в расширении: другой аккаунт → новый WalletAccount,
   * отзыв доступа / блокировка → null. Срабатывает только при реальной смене.
   */
  onAccountChange(listener: (account: WalletAccount | null) => void): Unsubscribe
  /** Расширение появилось или пропало (регистрируется асинхронно после загрузки страницы) */
  onAvailabilityChange(listener: () => void): Unsubscribe
}
