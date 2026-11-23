# Divra — frontend

Divra — общий кошелёк для компании. Расходы делятся как в Splitwise, а долги закрываются переводом стейблкоина
(USDC/USDT) в сети Solana: одной транзакцией, без посредника. Divra деньги не хранит: переводы идут напрямую
между кошельками, бэкенд только собирает транзакции и сверяет результат в сети.

Это веб-приложение (React). Сервер лежит рядом, в [`../backend`](../backend/README.md). Фронт работает и без него,
на встроенном моке: удобно для дизайна и разработки интерфейса.

## Содержание

- [Быстрый старт](#быстрый-старт)
- [Что умеет приложение](#что-умеет-приложение)
- [Документация](#документация)
- [Сети, кошельки, монеты и валюты](#сети-кошельки-монеты-и-валюты)
- [Структура](#структура)
- [Правила проекта](#правила-проекта)
- [Работа с ИИ-ассистентом](#работа-с-ии-ассистентом)
- [Скрипты, тесты, коммиты](#скрипты)

## Быстрый старт

Нужны Node.js 24 (`nvm use`) и кошелёк Solana в браузере: [Phantom](https://phantom.com) или
[Solflare](https://solflare.com), переключённый на **devnet**.

### Только фронт, всё на моке

```bash
cd frontend
nvm use
cp .env.example .env.local     # VITE_API_MOCK=true — бэкенд имитируется в браузере
npm i
npm run dev                    # http://localhost:5173
```

Мок по-настоящему собирает транзакции и проверяет подписи, но в сеть ничего не отправляет. Демо-данные
(группы, курсы) включаются фича-флагами в «Настройках» (`mock.groups`, `mock.rates`). По умолчанию всё пусто,
как у нового пользователя.

### С настоящим бэкендом

```bash
# backend: PostgreSQL в Docker, миграции, API на :3000 (подробно — backend/README.md)
cd backend && cp .env.example .env    # JWT_SECRET: openssl rand -base64 48
docker compose up -d && npm i && npm run db:migrate && npm run start:dev

# frontend: в .env.local
VITE_API_MOCK=true          # курсы валют — пока из мока (на бэкенде их нет)
VITE_AUTH_MOCK=false        # вход — через бэкенд (JWT)
VITE_GROUPS_MOCK=false      # группы, расходы, приглашения, запросы, расчёты — через бэкенд
```

В dev Vite проксирует `/api` на `VITE_API_PROXY_TARGET` (по умолчанию `http://localhost:3000`). Для браузера
это один origin, поэтому cookie с refresh-токеном работает без CORS.

Тестовые USDC для devnet выдаёт [faucet.circle.com](https://faucet.circle.com), а SOL на комиссии —
[faucet.solana.com](https://faucet.solana.com).

### Переменные окружения

Все переменные описаны в [`.env.example`](.env.example), проверяются zod-схемой в
[`src/shared/config/env.ts`](src/shared/config/env.ts) и типизированы в `src/vite-env.d.ts`. Новую переменную нужно
добавить во все три места.

| Переменная              | По умолчанию            | Назначение                                                                       |
| ----------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `VITE_API_URL`          | `/api`                  | Адрес API                                                                        |
| `VITE_API_PROXY_TARGET` | `http://localhost:3000` | Куда dev-сервер проксирует `/api`                                                |
| `VITE_API_MOCK`         | `true`                  | Мок по умолчанию для всех доменов (сейчас фактически только курсы)               |
| `VITE_AUTH_MOCK`        | как `VITE_API_MOCK`     | Вход: мок или бэкенд                                                             |
| `VITE_GROUPS_MOCK`      | как `VITE_API_MOCK`     | Группы, участники, приглашения, расходы, запросы, расчёты — переключаются вместе |
| `VITE_FLAGS_SOURCE`     | `local` при моке        | Фича-флаги: localStorage или `GET /flags`                                        |
| `VITE_SOLANA_CLUSTER`   | `devnet`                | `devnet` / `testnet` / `mainnet-beta`                                            |
| `VITE_SOLANA_RPC_URL`   | публичный RPC кластера  | RPC для мока                                                                     |
| `VITE_SITE_URL`         | —                       | Абсолютные ссылки в SEO-тегах                                                    |

Мок переключается **по доменам**. Так API можно переносить на бэкенд по частям: мок не знает групп бэкенда, а
бэкенд не знает групп мока, поэтому всё, что связано с группами, переключается одной переменной.

## Что умеет приложение

| Возможность                                                              | Где в коде                                                           | Подробно                                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Вход без пароля: подпись транзакции-вызова кошельком → JWT               | `pages/connect`, `pages/verify`, `features/wallet-auth`              | [wallet-verification.md](docs/architecture/wallet-verification.md)                         |
| Сессия: access-токен только в памяти, refresh — в HttpOnly-cookie        | `entities/wallet`, `shared/api/client.ts`, `app/state`               | [wallet-verification.md](docs/architecture/wallet-verification.md)                         |
| Смена аккаунта в расширении без разлогина                                | `entities/wallet/ui` (`WalletMismatch*`, `useWalletGuard`)           | [wallets.md](docs/architecture/wallets.md)                                                 |
| Главная: итог по всем группам, список групп, лента «Недавнее»            | `pages/home`                                                         | [groups-and-members.md](docs/architecture/groups-and-members.md)                           |
| Группы, участники без кошелька, общие и персональные приглашения         | `pages/group`, `pages/members`, `pages/join`                         | [groups-and-members.md](docs/architecture/groups-and-members.md)                           |
| Расходы в ₸ / ₽ / $, деление поровну / точно / % / долями, без копеек    | `pages/add-expense`                                                  | [expenses.md](docs/architecture/expenses.md), [currency.md](docs/architecture/currency.md) |
| Правка и удаление расхода (автор или плательщик)                         | `pages/add-expense` (`/expenses/:id/edit`), `pages/group`            | [expenses.md](docs/architecture/expenses.md)                                               |
| Выйти из группы, удалить участника без кошелька, отозвать ссылку         | `pages/members`                                                      | [groups-and-members.md](docs/architecture/groups-and-members.md)                           |
| «Кто кому» после взаимозачёта, суммы в стейблкоине или в своей валюте    | `pages/group`, `entities/currency`                                   | [currency.md](docs/architecture/currency.md)                                               |
| «Запросить»: ссылка и QR Solana Pay, «Отправленные» со статусами         | `pages/request`                                                      | [payments.md](docs/architecture/payments.md)                                               |
| Напомнить должнику (раз в сутки), отменить запрос                        | `pages/request` (`SentRequestActions`)                               | [payments.md](docs/architecture/payments.md)                                               |
| «Вернули наличными»: долг закрывает тот, кому должны                     | `pages/group` (`CashDialog`)                                         | [payments.md](docs/architecture/payments.md)                                               |
| Переводы мимо Divra: карточка «засчитать в долг?»                        | `features/detected-transfers`                                        | [payments.md](docs/architecture/payments.md)                                               |
| Обновление экранов в реальном времени (WebSocket)                        | `app/state/ServerEventsSync`, `shared/api/events`                    | [state-and-data.md](docs/architecture/state-and-data.md)                                   |
| «История»: переводы в сети, бесконечная прокрутка                        | `pages/home` (`HistorySection`), `pages/history`, `entities/history` | [state-and-data.md](docs/architecture/state-and-data.md)                                   |
| Страница оплаты для друга (без аккаунта): оплата из кошелька, «Оплачено» | `pages/pay-request`                                                  | [payments.md](docs/architecture/payments.md)                                               |
| «Рассчитаться»: все долги одной транзакцией                              | `pages/settle`                                                       | [payments.md](docs/architecture/payments.md)                                               |
| Ссылки на транзакции в Solscan                                           | `shared/ui/explorer-link`                                            | [payments.md](docs/architecture/payments.md)                                               |
| Настройки: имя профиля, валюта ввода, стейблкоин, фича-флаги, аккаунт    | `pages/settings`                                                     | [feature-flags.md](docs/architecture/feature-flags.md)                                     |
| Удалить аккаунт                                                          | `features/wallet-auth` (`DeleteAccountButton`)                       | [wallet-verification.md](docs/architecture/wallet-verification.md)                         |

## Документация

Сначала прочитай [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): там стек, слои, поток входа и **журнал
решений**. Любое архитектурное решение записывается туда строкой с причиной и ссылкой на подробности.

| Документ                                                                        | О чём                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)                                         | Точка входа: стек, слои, журнал решений                                  |
| [architecture/wallets.md](docs/architecture/wallets.md)                         | Слой адаптеров кошельков, смена аккаунта, как добавить кошелёк и сеть    |
| [architecture/wallet-verification.md](docs/architecture/wallet-verification.md) | Вход по подписи, контракт `/auth/*`, JWT и refresh, что проверяет бэкенд |
| [architecture/state-and-data.md](docs/architecture/state-and-data.md)           | zustand и TanStack Query, кэш, переменные окружения                      |
| [architecture/groups-and-members.md](docs/architecture/groups-and-members.md)   | Группы, участники, приглашения                                           |
| [architecture/expenses.md](docs/architecture/expenses.md)                       | Форма расхода, способы деления, точность до цента                        |
| [architecture/currency.md](docs/architecture/currency.md)                       | Валюты ввода, курсы, как добавить валюту                                 |
| [architecture/payments.md](docs/architecture/payments.md)                       | «Рассчитаться» и «Запросить», Solana Pay                                 |
| [architecture/feature-flags.md](docs/architecture/feature-flags.md)             | Фича-флаги, применение на лету                                           |
| [architecture/ui.md](docs/architecture/ui.md)                                   | Дизайн-система в коде, анимации, доступность                             |
| [design-system/README.md](design-system/README.md)                              | Направление дизайна «Calm Fintech», токены, компоненты, SEO              |
| [../backend/README.md](../backend/README.md)                                    | API, безопасность, схема БД, как бэкенд проверяет оплаты и расчёты       |

## Сети, кошельки, монеты и валюты

**Сеть.** Сейчас поддерживается Solana: `devnet`, `testnet` и `mainnet-beta` (выбирается `VITE_SOLANA_CLUSTER`).
Архитектура рассчитана на несколько сетей: идентификаторы `solana | ethereum | ton | tron` перечислены в
[`shared/config/chains.ts`](src/shared/config/chains.ts), а сеть добавляется отдельным модулем адаптеров.

**Кошельки.** Phantom и Solflare подключаются через [Wallet Standard](https://github.com/wallet-standard/wallet-standard),
без `window.phantom`. Один кошелёк — один файл в [`shared/lib/wallets/solana/`](src/shared/lib/wallets/solana).
Приложение работает только с интерфейсом `WalletAdapter` и не знает, какая под ним сеть.

**Монеты для расчётов** — [`shared/config/stablecoins.ts`](src/shared/config/stablecoins.ts). Те же адреса
продублированы на бэкенде в `backend/src/payments/solana/stablecoins.ts`:

| Сеть           | USDC                                           | USDT                                           |
| -------------- | ---------------------------------------------- | ---------------------------------------------- |
| `mainnet-beta` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| `devnet`       | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | — (у Tether нет devnet-токена)                 |
| `testnet`      | —                                              | —                                              |

Стейблкоин считается равным доллару 1:1, поэтому все суммы в группе хранятся в долларах, в целых центах.

**Валюты ввода** — [`shared/config/currencies.ts`](src/shared/config/currencies.ts): `KZT ₸`, `RUB ₽` (обе без
копеек) и `USD $`. Расход вводится в своей валюте и сохраняется в долларах по курсу на момент записи; исходная сумма
и курс тоже сохраняются. Расходы в валютах, которых больше нет в списке, продолжают открываться.

Куда смотреть, если нужно что-то добавить:

| Что добавить               | Где                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Валюту ввода               | `currencies.ts` (код, символ, название, точность — TypeScript не даст пропустить), курс в мок `shared/api/mock/rates.ts`, позже на бэкенде `/rates` |
| Стейблкоин                 | `STABLECOINS` в `currencies.ts`, адреса в `stablecoins.ts` фронта и бэкенда, enum в схеме БД бэкенда                                                |
| Кошелёк Solana             | новый файл в `shared/lib/wallets/solana/` по образцу `phantom.ts` и строка в `index.ts`                                                             |
| Сеть (Ethereum, TON, TRON) | модуль `shared/lib/wallets/<сеть>/`, вариант `SignRequest`, вход и переводы на бэкенде; см. [wallets.md](docs/architecture/wallets.md)              |

## Структура

```
frontend/
├── docs/                   ARCHITECTURE.md + architecture/*.md — описание и решения
├── design-system/          дизайн-система: токены, эталонные компоненты, иконки, SEO
├── e2e/                    Playwright
├── public/                 иконки, manifest, og-картинка
└── src/
    ├── app/                точка входа, провайдеры, роутер (SessionGate), глобальные стили
    ├── pages/              connect, verify, home, group, add-expense, members, join,
    │                       request, pay-request, settle, settings, error, not-found
    ├── widgets/            (пока пусто)
    ├── features/
    │   └── wallet-auth/    подключение, подтверждение и отключение кошелька
    ├── entities/
    │   ├── wallet/         сессия кошелька (zustand) + синхронизация с расширением
    │   ├── currency/       настройки валюты и стейблкоина, useMoney — как показывать суммы
    │   └── expense/        категории расходов
    └── shared/
        ├── api/            HTTP-клиент, API по доменам (auth, groups, payments, rates),
        │                   zod-схемы = контракт с бэкендом, mock/ — бэкенд в браузере
        ├── config/         env, ROUTES, сети, валюты, стейблкоины, фича-флаги
        ├── lib/            wallets/, feature-flags/, format, encoding, animation, test
        └── ui/             компоненты дизайн-системы
```

## Правила проекта

Эти правила держат проект в нынешней форме. Если меняешь любое из них, запиши новое решение в журнал
`docs/ARCHITECTURE.md`.

- **Feature-Sliced Design.** Импорты только сверху вниз (`app → pages → widgets → features → entities → shared`),
  наружу слайс отдаёт только то, что в его `index.ts`, импорты между слоями — через `@/`. Проверяет `npm run lint:fsd`.
- **Данные.** Ответы сервера живут только в TanStack Query, zustand — только для сессии кошелька. Данные групп
  свежие 30 секунд, мутации сбрасывают их кэш сами.
- **zod на каждой границе:** env, запросы и ответы API, localStorage. Схемы в `shared/api/*/schemas.ts` — это
  контракт с бэкендом: меняешь схему — меняй и бэкенд.
- **Деньги** хранятся в долларах, считаются в целых центах. Деление — методом наибольших остатков: сумма долей
  всегда равна сумме расхода. Для валют без копеек деление идёт целыми единицами.
- **Безопасность.** Access-токен никогда не попадает в localStorage. Клиент не задаёт ни сумму запроса, ни
  получателя, ни адреса перевода: всё это решает бэкенд, а долг гасится только переводом, который бэкенд нашёл в
  сети. Ключи и секреты во фронте не хранятся.
- **Мок обязан вести себя как бэкенд:** те же схемы, те же ошибки, настоящая криптография. Он грузится отдельным
  чанком, только когда включён.
- **Язык.** Интерфейс, комментарии и документация — на русском. Обращение к пользователю — на «ты».
- **Перед коммитом** `npm run check` должен быть зелёным.

## Работа с ИИ-ассистентом

Проект писался вместе с ИИ, и структура рассчитана на то, чтобы ассистент быстро входил в контекст. Чтобы продолжить:

1. **Дай ассистенту прочитать** этот README, затем `docs/ARCHITECTURE.md`, затем документ по нужной подсистеме из
   [таблицы](#документация). Если задача про сервер — ещё `../backend/README.md`.
2. **Попроси соблюдать [правила проекта](#правила-проекта)** и после изменений прогонять `npm run check` во фронте
   и `npm run lint && npm test && npm run test:e2e` в бэкенде.
3. **Новое архитектурное решение** — строка в журнале `docs/ARCHITECTURE.md` (что решили и почему) плюс правка
   нужного файла в `docs/architecture/`. Новая переменная окружения — в три места (см. выше).
4. **Новая функция «от бэкенда до экрана»** делается в таком порядке: zod-схема в `shared/api` → мок в
   `shared/api/mock` → экран → эндпоинт на бэкенде с e2e-тестами → переключение домена с мока на бэкенд.

Пример первого сообщения ассистенту:

> Прочитай frontend/README.md, frontend/docs/ARCHITECTURE.md и backend/README.md. Соблюдай правила проекта из
> README. Задача: …

## Скрипты

| Команда                 | Что делает                                            |
| ----------------------- | ----------------------------------------------------- |
| `npm run dev`           | Dev-сервер                                            |
| `npm run build`         | Проверка типов и продакшен-сборка                     |
| `npm run preview`       | Просмотр сборки                                       |
| `npm run typecheck`     | Проверка типов                                        |
| `npm run lint`          | oxlint                                                |
| `npm run lint:fix`      | oxlint с автоисправлением                             |
| `npm run lint:fsd`      | Проверка архитектуры FSD (steiger)                    |
| `npm run format`        | Форматирование (oxfmt)                                |
| `npm run format:check`  | Проверка форматирования                               |
| `npm run test`          | Vitest в watch-режиме                                 |
| `npm run test:run`      | Vitest, один прогон                                   |
| `npm run test:coverage` | Vitest с отчётом о покрытии                           |
| `npm run test:e2e`      | e2e-тесты Playwright                                  |
| `npm run check`         | typecheck + lint + lint:fsd + format:check + test:run |

## Тесты

**Юнит и компонентные (Vitest).** Файлы `*.test.ts(x)` лежат рядом с кодом. Окружение — jsdom, матчеры jest-dom
подключены в `src/shared/lib/test/setup.ts`. Компонентам с роутером помогает `renderWithRouter`, демо-данным —
`enableDemoData` (оба в `@/shared/lib/test`):

```tsx
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'

enableDemoData()
const { user } = renderWithRouter(<GroupPage />, {
  route: '/groups/burabay',
  path: '/groups/:groupId',
})
```

**e2e (Playwright).** Тесты лежат в `e2e/`. Playwright сам собирает проект и поднимает `vite preview`. Перед
первым запуском установи браузер: `npx playwright install chromium`.

## Коммиты

Формат [Conventional Commits](https://www.conventionalcommits.org/ru/): `feat: ...`, `fix: ...`, `refactor: ...`,
`chore: ...`. Конфиг хуков — [`lefthook.yml`](lefthook.yml): перед коммитом oxfmt и oxlint на изменённых файлах,
commitlint проверяет сообщение. Теперь git-репозиторий — корневая папка (`frontend/` и `backend/` вместе), а
`lefthook.yml` лежит во `frontend/`, поэтому хуки сами не срабатывают. Пока они не перенесены в корень, перед
коммитом запускай `npm run check` вручную.
