# Divra — backend

API для Divra: группы, расходы, долги и их погашение стейблкоином (USDC/USDT) в сети Solana. Сервер не держит
деньги и ключи пользователей. Он проверяет вход по подписи кошелька, считает долги, собирает транзакции переводов
и засчитывает оплату только тогда, когда сам нашёл и проверил перевод в сети.

Веб-приложение лежит рядом, в [`../frontend`](../frontend/README.md).

## Содержание

- [Быстрый старт](#быстрый-старт)
- [Переменные окружения](#переменные-окружения)
- [API](#api)
- [Документация](#документация)
- [Сети и монеты](#сети-и-монеты)
- [Структура](#структура)
- [Правила проекта](#правила-проекта)
- [Работа с ИИ-ассистентом](#работа-с-ии-ассистентом)
- [Скрипты и тесты](#скрипты)
- [Чего пока нет](#чего-пока-нет)

## Быстрый старт

Нужны Node.js ≥ 22.12 (фронту нужен 24, так что удобно взять 24) и PostgreSQL 17 (или Docker).

```bash
cd backend
cp .env.example .env              # и задай JWT_SECRET: openssl rand -base64 48
docker compose up -d              # PostgreSQL на 127.0.0.1:5432, база divra (или свой: createdb divra)
npm install
npm run db:migrate
npm run start:dev                 # http://localhost:3000/api
```

Фронтенд в dev ходит сюда через прокси Vite (`/api` → `localhost:3000`), поэтому для браузера это один origin.
Чтобы фронт работал с этим сервером, а не с моком, выключи моки во `frontend/.env.local` — см.
[frontend/README.md](../frontend/README.md#быстрый-старт).

Посмотреть базу — Drizzle Studio (адрес берёт из `.env`, схему — из `src/database/schema`):

```bash
npm run db:studio                 # https://local.drizzle.studio
```

**Деньги для проверки на devnet.** SOL на комиссии — [faucet.solana.com](https://faucet.solana.com), devnet USDC —
[faucet.circle.com](https://faucet.circle.com) (сеть Solana Devnet). Кошелёк в браузере переключи на devnet. У
Tether нет devnet-токена, поэтому USDT проверяется только на mainnet.

## Переменные окружения

Описание — [`.env.example`](.env.example), проверка при старте — [`src/config/config.ts`](src/config/config.ts) (zod).

| Переменная                                | По умолчанию             | Что задаёт                                                                    |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `NODE_ENV`, `PORT`                        | `development`, `3000`    | Режим и порт                                                                  |
| `DATABASE_URL`                            | локальный `divra`        | PostgreSQL                                                                    |
| `JWT_SECRET`                              | —                        | Ключ HS256, от 32 байт. В production пример из `.env.example` не принимается  |
| `JWT_ISSUER`, `JWT_AUDIENCE`              | `divra-api`, `divra-web` | Claims `iss` и `aud`                                                          |
| `ACCESS_TOKEN_TTL`                        | `15m`                    | Жизнь access-токена (отозвать раньше нельзя, поэтому коротко)                 |
| `REFRESH_TOKEN_TTL`, `REFRESH_FAMILY_TTL` | `7d`, `30d`              | Жизнь refresh-токена и всей цепочки ротаций                                   |
| `APP_ORIGIN`                              | `http://localhost:5173`  | Фронтенд: CORS, проверка `Origin`, домен в сообщении для подписи, ссылки      |
| `COOKIE_SECURE`                           | `false`                  | `false` — только для http://localhost; в production cookie всегда `Secure`    |
| `TRUST_PROXY`                             | `0`                      | Сколько прокси перед приложением (для IP в лимитах)                           |
| `SOLANA_CLUSTER`                          | `devnet`                 | `devnet`, `testnet` или `mainnet-beta`                                        |
| `SOLANA_RPC_URL`                          | пусто — публичный RPC    | Свой RPC (для mainnet обязательно: публичный режет лимиты)                    |
| `CHALLENGE_TTL_SECONDS`                   | `300`                    | Сколько живёт вызов на подпись                                                |
| `PAYMENT_WATCH_INTERVAL_MS`               | `20000`                  | Как часто искать оплату открытых запросов; `0` — только при открытии страницы |

Новая переменная добавляется в три места: zod-схему `src/config/config.ts`, `.env.example` и эту таблицу.

## API

Всё, что не помечено `@Public()`, требует `Authorization: Bearer <access-token>`: guard `@nestjs/authentication`
глобальный. Ошибки приходят в одном формате: `{ statusCode, error, message, timestamp, path }`.

| Метод | Путь                                      | Доступ                        | Что делает                                                            |
| ----- | ----------------------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| POST  | `/api/auth/wallet/challenge`              | публичный                     | Вызов на подпись: memo-транзакция с доменом, адресом, nonce и сроком  |
| POST  | `/api/auth/wallet/verify`                 | публичный, только с фронтенда | Проверка подписи → вход; access-токен в ответе, refresh в cookie      |
| POST  | `/api/auth/refresh`                       | cookie                        | Ротация refresh-токена, новый access-токен                            |
| POST  | `/api/auth/sign-out`                      | cookie                        | Отзыв refresh-токена этого устройства                                 |
| GET   | `/api/me`                                 | JWT                           | Профиль и кошельки                                                    |
| GET   | `/api/me/overview`                        | JWT                           | Главная: «тебе должны / ты должен», группы с балансом, «Недавнее»     |
| POST  | `/api/groups`                             | JWT                           | Новая группа, создатель — первый участник                             |
| GET   | `/api/groups/:id/overview`                | участник группы               | Участники, баланс, долги после зачёта, расходы                        |
| POST  | `/api/groups/:id/members`                 | участник группы               | Участник по имени, без кошелька                                       |
| POST  | `/api/groups/:id/expenses`                | участник группы               | Расход: плательщик, доли, исходная валюта и курс                      |
| POST  | `/api/groups/:id/invites`                 | участник группы               | Приглашение: общее или персональное (`claimMemberId`)                 |
| GET   | `/api/invites/:code`                      | публичный                     | Превью приглашения до входа                                           |
| POST  | `/api/invites/:code/accept`               | JWT                           | Вступить в группу                                                     |
| POST  | `/api/groups/:id/payment-requests`        | участник группы               | «Запросить»: ссылка Solana Pay на каждого должника                    |
| GET   | `/api/groups/:id/payment-requests`        | участник группы               | «Отправленные»: статус (ждёт / оплачен / истёк), ссылка; последние 50 |
| GET   | `/api/payment-requests/:code`             | публичный                     | Страница запроса для плательщика; заодно ищет оплату в сети           |
| POST  | `/api/payment-requests/:code/transaction` | публичный, только с фронтенда | Собрать перевод для кошелька плательщика (`{ account }`)              |
| POST  | `/api/payment-requests/:code/submit`      | публичный, только с фронтенда | Отправить подписанный перевод в сеть                                  |
| POST  | `/api/groups/:id/settlements`             | участник группы               | «Рассчитаться»: собрать одну транзакцию с переводами выбранным        |
| POST  | `/api/groups/:id/settlements/:sid/submit` | тот, кто собрал               | Отправить подписанную транзакцию, дождаться и сверить в сети          |
| GET   | `/api/wallets/:address/balances`          | JWT, только свой кошелёк      | Балансы USDC/USDT                                                     |
| GET   | `/api/health`                             | публичный                     | Проверка живости                                                      |

«Только с фронтенда» — `BrowserRequestGuard`: заголовок `X-Divra-Client: web` и свой `Origin`. Форматы тел и
ответов — zod-схемы в `src/**/*.schemas.ts`; фронтенд проверяет ответы своими схемами в
`frontend/src/shared/api/*/schemas.ts`, и они должны совпадать.

## Документация

Сначала прочитай [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): там стек, модули, жизненный цикл запроса, модель
данных и **журнал решений**. Любое архитектурное решение записывается туда строкой с причиной и ссылкой на подробности.

| Документ                                                                        | О чём                                                                |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)                                         | Точка входа: стек, модули, модель данных, журнал решений             |
| [architecture/auth-and-security.md](docs/architecture/auth-and-security.md)     | Вход по подписи, JWT и refresh, CSRF/CORS, лимиты, заголовки, конфиг |
| [architecture/groups-and-expenses.md](docs/architecture/groups-and-expenses.md) | Группы, участники, расходы, как считаются долги                      |
| [architecture/invites.md](docs/architecture/invites.md)                         | Общие и персональные приглашения                                     |
| [architecture/payments.md](docs/architecture/payments.md)                       | «Запросить», оплата со страницы, «Рассчитаться», сверка в сети       |
| [architecture/database.md](docs/architecture/database.md)                       | Таблицы, ключи и индексы, миграции                                   |
| [architecture/testing.md](docs/architecture/testing.md)                         | Юнит и e2e, PGlite, подмена сети Solana, как писать тест             |
| [../frontend/README.md](../frontend/README.md)                                  | Веб-приложение: экраны, кошельки, валюты, мок                        |

## Сети и монеты

**Сеть** — Solana (`SOLANA_CLUSTER`: `devnet`, `testnet`, `mainnet-beta`). Вся работа с сетью спрятана за
абстрактными классами в `src/payments/solana/` и `src/auth/solana/`, поэтому другая сеть добавляется своей
реализацией этих классов.

**Монеты** — [`src/payments/solana/stablecoins.ts`](src/payments/solana/stablecoins.ts), те же адреса во
`frontend/src/shared/config/stablecoins.ts`:

| Сеть           | USDC                                           | USDT                                           |
| -------------- | ---------------------------------------------- | ---------------------------------------------- |
| `mainnet-beta` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| `devnet`       | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | — (у Tether нет devnet-токена)                 |
| `testnet`      | —                                              | —                                              |

Стейблкоин равен доллару 1:1, поэтому суммы хранятся в **целых центах доллара**. У USDC и USDT 6 знаков:
1 цент = 10 000 минимальных единиц (`RAW_UNITS_PER_CENT`).

**Валюты расходов.** Расход приходит уже в долларах; исходная сумма, валюта и курс сохраняются для показа и
должны давать ту же сумму (±1 цент). Список валют ввода ведёт фронтенд (сейчас ₸, ₽, $). Курсы сервер пока не
сверяет — см. [Чего пока нет](#чего-пока-нет).

## Структура

```
backend/
├── src/
│   ├── main.ts, bootstrap.ts   запуск: /api, helmet, CORS, cookie, лимит тела
│   ├── app.module.ts           модули, глобальные guard'ы, zod-pipe, фильтр ошибок
│   ├── config/                 zod-схема окружения
│   ├── database/               Drizzle, schema/*.ts — все таблицы
│   ├── common/                 фильтр ошибок, доменные ошибки
│   ├── auth/                   вход по подписи, refresh, CSRF-guard, транзакция-вызов
│   ├── users/                  пользователи и кошельки, /me
│   ├── groups/                 группы, участники, расходы, журнал долгов, /me/overview
│   ├── invites/                приглашения
│   ├── payments/               запросы оплаты, оплата со страницы, фоновый поиск
│   │   ├── settlements/        «Рассчитаться», балансы
│   │   └── solana/             поиск и отправка транзакций, сборка переводов, монеты
│   └── health/
├── drizzle/                    миграции (не редактировать применённые)
├── test/                       e2e: test-app.ts (PGlite + фейки сети), session.ts, *.e2e-spec.ts
└── docs/                       архитектура и журнал решений
```

Модуль устроен одинаково: контроллер (HTTP, guard'ы, лимиты) → сервис (правила, HTTP-ошибки) → репозиторий
(абстрактный класс + `Drizzle*`, только SQL и транзакции).

## Правила проекта

Эти правила держат проект в нынешней форме. Если меняешь любое из них, запиши новое решение в журнал
`docs/ARCHITECTURE.md`.

- **Деньги — целые центы** (`integer`). Больше двух знаков после запятой во входе — 400, не округление.
- **zod на каждой границе:** окружение, тела запросов (`@Body({ schema })`, `z.strictObject`). Лишние поля — 400.
- **Не доверять клиенту.** Суммы запросов и расчётов, получатели и их адреса вычисляет сервер. Получатель запроса и
  плательщик расчёта — только свой кошелёк. Долг гасится только переводом, найденным и проверенным в сети.
- **Чужое неотличимо от несуществующего:** чужая группа, несуществующая группа и кривой id — один 404.
- **Инварианты — в базе:** составные внешние ключи `(group_id, member_id)`, уникальные и частичные индексы.
  Проверка в сервисе дублирует их ради понятной ошибки, но не заменяет.
- **Гонки:** блокировки строк (`.for('update')`), атомарные переходы `UPDATE … WHERE status`, `onConflictDoNothing`.
  Лимиты проверяются под блокировкой.
- **Сеть Solana — только через абстракции** (`PaymentLookup`, `TransactionSender`, `BalanceReader`,
  `BlockhashSource`). Тесты в сеть не ходят.
- **Миграции** — только `npm run db:generate`; применённые не редактируются.
- **Ответы совпадают со схемами фронтенда.** Меняешь форму ответа — меняй `frontend/src/shared/api/*/schemas.ts`
  и мок фронтенда.
- **Каждый эндпоинт — с e2e-тестом,** включая негативные случаи (чужой доступ, гонки, валидация).
- **Язык.** Сообщения об ошибках, комментарии и документация — на русском.
- **Перед коммитом** зелёные `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`.

## Работа с ИИ-ассистентом

Проект писался вместе с ИИ, и структура рассчитана на то, чтобы ассистент быстро входил в контекст. Чтобы продолжить:

1. **Дай ассистенту прочитать** этот README, затем `docs/ARCHITECTURE.md`, затем документ по нужной подсистеме из
   [таблицы](#документация). Если задача касается экранов — ещё `../frontend/README.md`.
2. **Попроси соблюдать [правила проекта](#правила-проекта)** и после изменений прогонять
   `npm run typecheck && npm run lint && npm test && npm run test:e2e`.
3. **Новое архитектурное решение** — строка в журнале `docs/ARCHITECTURE.md` плюс правка файла в
   `docs/architecture/`. Новая таблица — в [database.md](docs/architecture/database.md).
4. **Новый эндпоинт** делается так: zod-схема тела → репозиторий (абстракция + Drizzle) → сервис → контроллер →
   e2e в `test/` → строка в таблице API → схема и мок во фронтенде.

Пример первого сообщения ассистенту:

> Прочитай backend/README.md, backend/docs/ARCHITECTURE.md и frontend/README.md. Соблюдай правила проекта из
> README. Задача: …

## Скрипты

| Команда               | Что делает                                  |
| --------------------- | ------------------------------------------- |
| `npm run start:dev`   | Dev-сервер с перезапуском                   |
| `npm run start:debug` | То же с отладчиком                          |
| `npm run build`       | Сборка в `dist/`                            |
| `npm run start:prod`  | Запуск сборки                               |
| `npm run typecheck`   | Проверка типов                              |
| `npm run lint`        | oxlint                                      |
| `npm run format`      | prettier                                    |
| `npm test`            | Юнит-тесты                                  |
| `npm run test:watch`  | Юнит-тесты в watch-режиме                   |
| `npm run test:e2e`    | e2e на PGlite                               |
| `npm run db:generate` | Миграция из изменений `src/database/schema` |
| `npm run db:migrate`  | Применить миграции к `DATABASE_URL`         |
| `npm run db:studio`   | Drizzle Studio                              |

## Тесты

```bash
npm test            # юнит: чистые функции рядом с кодом
npm run test:e2e    # всё приложение на PGlite (PostgreSQL в процессе), своя база и сеть не нужны
```

e2e поднимают настоящее приложение с настоящими миграциями, а сеть Solana подменяют фейками из
`test/test-app.ts`. Покрыты вход и токены, CSRF и CORS, лимиты, группы, расходы и зачёт, приглашения, запросы,
оплата со страницы, расчёты и гонки. Подробно — [testing.md](docs/architecture/testing.md).

## Чего пока нет

- Досрочного отзыва access-токенов (живут до 15 минут, поэтому короткие).
- Удаления аккаунта (нужен `TokenService.revokeAll()`: токены не связаны с `users` внешним ключом).
- Чистки `refresh_token_family_revocations` по сроку.
- Отзыва приглашения и запроса оплаты вручную.
- Напоминаний должнику.
- Курсов на сервере (`/rates`): сейчас сервер проверяет только согласованность суммы и курса из клиента.
- Фонового поиска оплат в нескольких репликах (нужен advisory lock или отдельный воркер).
