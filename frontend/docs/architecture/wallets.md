# Кошельки и сети

## Структура

```
src/shared/lib/wallets/
├── core/
│   ├── types.ts               WalletAdapter, WalletAccount, SignRequest/SignResult
│   ├── errors.ts              WalletError + нормализация ошибок кошельков
│   └── use-wallet-adapters.ts хук: перерисовка, когда расширение появилось / сменило иконку
├── solana/
│   ├── create-standard-adapter.ts  общий адаптер Wallet Standard
│   ├── cluster.ts             solana:devnet | solana:mainnet …
│   ├── phantom.ts             ← один кошелёк = один файл
│   ├── solflare.ts
│   └── index.ts               solanaWallets
└── index.ts                   walletAdapters = [...solanaWallets, …], getWalletAdapter(id)
```

Сети перечислены в `shared/config/chains.ts` (`solana | ethereum | ton | tron`) — zod-enum,
которым валидируются и API, и сохранённая сессия.

## Интерфейс `WalletAdapter`

| Метод                         | Назначение                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| `id`                          | `<сеть>:<кошелёк>`, например `solana:phantom` — уникален во всём приложении |
| `getIcon()` / `isInstalled()` | Иконка берётся из самого расширения (актуальная, в SVG/data URI)            |
| `connect({ silent })`         | Открыть окно кошелька; `silent` — восстановить доступ без окна              |
| `disconnect()`                | Отозвать доступ в расширении                                                |
| `sign(request)`               | Подписать. `SignRequest` — размеченное объединение по сети                  |
| `onAccountChange(cb)`         | Другой аккаунт → `WalletAccount`, отзыв доступа → `null`                    |
| `onAvailabilityChange(cb)`    | Расширение зарегистрировалось или пропало                                   |

UI, стор и фичи работают только с этим интерфейсом и не знают, какая под ним сеть.

## Смена кошелька в расширении

1. Адаптер подписан на событие кошелька (для Solana — `standard:events` → `change`).
2. Если адрес изменился, адаптер вызывает `onAccountChange`. Повторы с тем же адресом отбрасываются.
3. `entities/wallet/model/use-wallet-session-sync.ts` передаёт событие в стор: `accountChanged(account)`.
4. Что делает стор, зависит от статуса:
   - **`connected`** (ещё не подписал) — сессия следует за расширением: новый адрес, `notice: 'account-changed'`.
   - **`verified`** — сессия **не сбрасывается**. В стор пишется только `walletAccount` — адрес,
     выбранный в расширении сейчас (не персистится). Вошли мы по-прежнему аккаунтом `account`.
5. Если `account` и `walletAccount` расходятся, `selectWalletMismatch` возвращает
   `'other-account'` или `'wallet-disconnected'` (доступ отозван).
6. `WalletMismatchBanner` (в `AppLayout`) показывает плашку с кнопкой «Исправить».
7. Действия, требующие подписи, оборачиваются в `useWalletGuard().requireWallet(action)`:
   при расхождении вместо действия открывается `WalletMismatchDialog`:
   - **Переподключить** — `adapter.connect()` и сверка адреса; если аккаунт всё ещё другой — ошибка в модалке;
   - **Войти как XXXX…** — `switchToWalletAccount`: новый аккаунт, переход на `/verify`;
   - **Отмена**.
     После устранения расхождения отложенное действие выполняется.

### Почему не разлогиниваем

В Chrome расширения по умолчанию общие для обычного окна и инкогнито. Вход другим аккаунтом
в инкогнито переключает аккаунт и в основном окне. Раньше это выкидывало пользователя из сессии,
хотя читать данные можно и без кошелька: сессия держится на `sessionToken`, а не на расширении.
Кошелёк нужен только для подписи, поэтому проверяем его только там.

Пустой список аккаунтов в событии (`[]`) бывает и кратковременно, при блокировке или переключении.
Поэтому на `null` синхронизация делает `connect({ silent: true })` и только при ошибке
считает кошелёк отключённым.

## Как добавить кошелёк Solana

Если кошелёк поддерживает Wallet Standard (почти все современные):

```ts
// src/shared/lib/wallets/solana/glow.ts
import { createSolanaStandardAdapter } from './create-standard-adapter'

export const glow = createSolanaStandardAdapter({
  slug: 'glow',
  name: 'Glow',
  standardName: 'Glow', // имя, под которым расширение регистрируется
  installUrl: 'https://glow.app',
})
```

И добавить его в `solana/index.ts`. Подпись в списке (`HINTS`) — в `features/wallet-auth/ui/WalletList.tsx`.

## Как добавить сеть

1. Папка `shared/lib/wallets/<сеть>/` с общим адаптером и файлом на каждый кошелёк.
2. Вариант сети в `SignRequest` / `SignResult` (`core/types.ts`).
3. Вариант в `walletChallengeSchema` (`shared/api/auth/schemas.ts`) — что бэкенд просит подписать.
4. Строка в `walletAdapters` (`shared/lib/wallets/index.ts`).

UI и стор менять не нужно.

| Сеть           | Протокол обнаружения и событий                                     | Что подписывать при подтверждении      | Пример кошельков                 |
| -------------- | ------------------------------------------------------------------ | -------------------------------------- | -------------------------------- |
| Ethereum / EVM | EIP-6963 (обнаружение), EIP-1193 `accountsChanged`, `chainChanged` | EIP-712 typed data или SIWE (EIP-4361) | MetaMask, Rabby, Coinbase Wallet |
| TON            | TON Connect 2 (`@tonconnect/sdk`), `onStatusChange`                | `ton_proof` при подключении            | Tonkeeper, MyTonWallet           |
| TRON           | `window.tronLink` / TIP-1193, событие `accountsChanged`            | `signMessageV2` или транзакция         | TronLink, TokenPocket            |

Для EVM `chainChanged` стоит обрабатывать так же, как смену аккаунта: адаптер отдаёт
`WalletAccount` с новой сетью, стор сбрасывает подтверждение.

## Ошибки

Ошибки кошельков приводятся к `WalletError` с кодом (`rejected`, `not-installed`, `no-account`,
`unsupported`, `not-connected`, `unknown`). Отказ пользователя (код 4001, `ACTION_REJECTED`,
«reject/denied/cancel» в тексте) — отдельный код, чтобы не пугать его как сбой.
Текст для UI — `walletErrorMessage(error)`.
