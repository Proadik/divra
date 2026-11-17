/**
 * Валюты ввода: в них пользователь записывает расход. В группе сумма хранится
 * в долларовом эквиваленте и рассчитывается стейблкоином 1:1 к доллару.
 */
/**
 * Как добавить валюту: код сюда, символ и название ниже (TypeScript не даст забыть),
 * курс — на бэкенде в `GET /rates` и в моке `shared/api/mock/rates.ts`.
 */
export const FIAT_CURRENCIES = ['KZT', 'RUB', 'USD'] as const
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number]

/** Стейблкоины для расчётов в Solana. Оба привязаны к доллару 1:1. */
export const STABLECOINS = ['USDC', 'USDT'] as const
export type Stablecoin = (typeof STABLECOINS)[number]

export const FIAT_SYMBOLS: Record<FiatCurrency, string> = {
  KZT: '₸',
  RUB: '₽',
  USD: '$',
}

/**
 * Сколько знаков после запятой показываем и вводим. Тенге и рубли — целыми: копейки и тиыны
 * на практике не считают, 120 000 ₸ на троих — это по 40 000 ₸, а не 40 000.19.
 */
export const FIAT_DECIMALS: Record<FiatCurrency, 0 | 2> = {
  KZT: 0,
  RUB: 0,
  USD: 2,
}

export const FIAT_NAMES: Record<FiatCurrency, string> = {
  KZT: 'Тенге',
  RUB: 'Рубль',
  USD: 'Доллар',
}

/** Символ по коду; валюта, которой больше нет в списке (старые расходы), — её код */
export const fiatSymbol = (code: string): string =>
  (FIAT_SYMBOLS as Record<string, string | undefined>)[code] ?? code
