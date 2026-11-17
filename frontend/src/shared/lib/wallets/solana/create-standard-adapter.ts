import {
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features'
import { getWallets } from '@wallet-standard/app'
import type { WalletAccount as StandardAccount, Wallet } from '@wallet-standard/base'
import {
  StandardConnect,
  type StandardConnectFeature,
  StandardDisconnect,
  type StandardDisconnectFeature,
  StandardEvents,
  type StandardEventsFeature,
} from '@wallet-standard/features'
import { WalletError, toWalletError } from '../core/errors'
import type { WalletAccount, WalletAdapter } from '../core/types'
import { SOLANA_CHAIN } from './cluster'

export type SolanaStandardWalletConfig = {
  /** Часть id после `solana:` */
  slug: string
  name: string
  /** Имя, под которым расширение регистрируется в Wallet Standard */
  standardName: string
  installUrl: string
}

const isSolanaAccount = (account: StandardAccount): boolean =>
  account.chains.some((chain) => chain.startsWith('solana:'))

const toAccount = (account: StandardAccount): WalletAccount => ({
  chain: 'solana',
  address: account.address,
})

/**
 * Адаптер для любого Solana-кошелька, реализующего Wallet Standard
 * (Phantom, Solflare и др.). Конкретные кошельки — отдельные файлы с конфигом.
 */
export const createSolanaStandardAdapter = (config: SolanaStandardWalletConfig): WalletAdapter => {
  const wallets = getWallets()
  const accountListeners = new Set<(account: WalletAccount | null) => void>()
  let current: StandardAccount | null = null
  let attachedWallet: Wallet | null = null
  let detachEvents: (() => void) | null = null

  const findWallet = (): Wallet | undefined =>
    wallets
      .get()
      .find(
        (wallet) =>
          wallet.name === config.standardName &&
          StandardConnect in wallet.features &&
          wallet.chains.some((chain) => chain.startsWith('solana:')),
      )

  const requireWallet = (): Wallet => {
    const wallet = findWallet()
    if (!wallet) {
      throw new WalletError('not-installed', `${config.name} не установлен`)
    }
    return wallet
  }

  const setCurrent = (next: StandardAccount | null): void => {
    if (next?.address === current?.address) {
      current = next
      return
    }
    current = next
    const account = next ? toAccount(next) : null
    accountListeners.forEach((listener) => listener(account))
  }

  /** Подписка на `standard:events` — так узнаём о смене аккаунта в расширении. */
  const attach = (): void => {
    const wallet = findWallet() ?? null
    if (wallet === attachedWallet) {
      return
    }
    detachEvents?.()
    detachEvents = null
    attachedWallet = wallet
    const events = wallet?.features[StandardEvents] as
      | StandardEventsFeature[typeof StandardEvents]
      | undefined
    detachEvents =
      events?.on('change', ({ accounts }) => {
        // Событие без accounts — сменились chains/features, аккаунт тот же
        if (!accounts || current === null) {
          return
        }
        setCurrent(accounts.find(isSolanaAccount) ?? null)
      }) ?? null
  }

  wallets.on('register', attach)
  wallets.on('unregister', attach)

  return {
    id: `solana:${config.slug}`,
    chain: 'solana',
    name: config.name,
    installUrl: config.installUrl,

    getIcon: () => findWallet()?.icon,

    isInstalled: () => findWallet() !== undefined,

    async connect(options) {
      const wallet = requireWallet()
      attach()
      try {
        const feature = wallet.features[
          StandardConnect
        ] as StandardConnectFeature[typeof StandardConnect]
        const { accounts } = await feature.connect({ silent: options?.silent })
        const account = accounts.find(isSolanaAccount) ?? wallet.accounts.find(isSolanaAccount)
        if (!account) {
          throw new WalletError('no-account', 'Нет Solana-аккаунта')
        }
        current = account
        return toAccount(account)
      } catch (error) {
        throw toWalletError(error)
      }
    },

    async disconnect() {
      const wallet = findWallet()
      current = null
      const feature = wallet?.features[StandardDisconnect] as
        | StandardDisconnectFeature[typeof StandardDisconnect]
        | undefined
      await feature?.disconnect().catch(() => undefined)
    },

    getAccount: () => (current ? toAccount(current) : null),

    async sign(request) {
      const wallet = requireWallet()
      if (!current) {
        throw new WalletError('not-connected', 'Сначала подключите кошелёк')
      }
      const feature = wallet.features[SolanaSignTransaction] as
        | SolanaSignTransactionFeature[typeof SolanaSignTransaction]
        | undefined
      if (!feature) {
        throw new WalletError('unsupported', `${config.name} не умеет подписывать транзакции`)
      }
      try {
        const [output] = await feature.signTransaction({
          account: current,
          transaction: request.transaction,
          chain: SOLANA_CHAIN,
        })
        if (!output) {
          throw new WalletError('unknown', 'Кошелёк не вернул подписанную транзакцию')
        }
        return { chain: 'solana', signedTransaction: output.signedTransaction }
      } catch (error) {
        throw toWalletError(error)
      }
    },

    onAccountChange(listener) {
      attach()
      accountListeners.add(listener)
      return () => {
        accountListeners.delete(listener)
      }
    },

    onAvailabilityChange(listener) {
      const offRegister = wallets.on('register', listener)
      const offUnregister = wallets.on('unregister', listener)
      return () => {
        offRegister()
        offUnregister()
      }
    },
  }
}
