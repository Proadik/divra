# Архитектура Divra (backend)

Точка входа в описание сервера. Детали по каждой подсистеме лежат в `docs/architecture/`. Любое архитектурное
решение записывается сюда, в журнал ниже, и в соответствующий файл.

## Стек

| Задача         | Решение                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------- |
| Фреймворк      | NestJS 12 (ESM, относительные импорты с `.js`)                                            |
| База           | PostgreSQL 17, Drizzle ORM + drizzle-kit (миграции в `drizzle/`)                          |
| Аутентификация | `@nestjs/authentication`: глобальный guard, JWT HS256, ротация refresh-токенов            |
| Валидация      | zod 4: тела запросов (`StandardSchemaValidationPipe`, `@Body({ schema })`), конфиг        |
| Solana         | `@solana/kit` (RPC, транзакции, подписи), `@solana-program/token`, `@solana-program/memo` |
| Защита         | helmet, `@nestjs/throttler`, cookie-parser, CORS только для `APP_ORIGIN`                  |
| Тесты          | Vitest 4: юнит рядом с кодом, e2e на PGlite (PostgreSQL внутри процесса) + supertest      |
| Качество       | TypeScript 6 strict, oxlint, prettier                                                     |

## Модули

```
src/
├── main.ts, bootstrap.ts   создание приложения: префикс /api, helmet, CORS, cookie, лимит тела, trust proxy
├── app.module.ts           подключение модулей, глобальные guard (auth, throttler), pipe (zod), filter
├── config/                 zod-схема переменных окружения, APP_CONFIG; отказ стартовать с опасным конфигом
├── database/               DrizzleModule, schema/*.ts — все таблицы, unique-violation → доменная ошибка
├── common/                 общий фильтр ошибок, доменные ошибки
├── auth/                   вход по подписи, refresh, sign-out, CSRF-guard, JWT-провайдер, транзакция-вызов
├── users/                  пользователи и кошельки, GET /me
├── groups/                 группы, участники, расходы, журнал долгов (ledger.ts), главная /me/overview
├── invites/                приглашения: общие и персональные, превью, вход по ссылке
├── events/                 DomainEvents (шина в процессе) и EventsGateway (socket.io для фронтенда)
├── transfers/              переводы мимо Divra: поток LaserStream (stream/), сопоставление, API подсказок
├── payments/               запросы оплаты (Solana Pay), оплата со страницы, фоновый поиск (payment-watcher.ts)
│   ├── settlements/        «Рассчитаться» и балансы кошелька
│   └── solana/             поиск и отправка транзакций, сборка переводов, адреса стейблкоинов
└── health/                 GET /health
```

Каждый модуль устроен одинаково: `*.controller.ts` (HTTP, лимиты, guard'ы) → `*.service.ts` (правила
предметной области, HTTP-ошибки) → репозиторий (абстрактный класс + реализация на Drizzle, только запросы
и транзакции). Всё, что ходит в сеть Solana, спрятано за абстрактными классами (`BlockhashSource`,
`PaymentLookup`, `TransactionSender`, `BalanceReader`), и в тестах они подменяются.

## Жизненный цикл запроса

1. `ThrottlerGuard`: лимит на IP (за прокси IP берётся с учётом `TRUST_PROXY`).
2. Guard `@nestjs/authentication`: без `@Public()` нужен `Authorization: Bearer <JWT>`. `JwtAuthProvider`
   проверяет, что пользователь ещё существует.
3. `BrowserRequestGuard` на cookie-эндпоинтах и на оплате со страницы: заголовок `X-Divra-Client: web` и
   свой `Origin` / `Sec-Fetch-Site`.
4. `StandardSchemaValidationPipe`: zod-схема тела. `strictObject`, поэтому лишние поля дают 400.
5. Сервис → репозиторий. Проверки доступа к группе делаются в одном запросе с данными: чужая группа неотличима
   от несуществующей (404).
6. `AllExceptionsFilter` приводит любую ошибку к виду `{ statusCode, error, message, timestamp, path }` и
   не раскрывает внутренности.

## Модель данных

Подробно — [database.md](architecture/database.md).

```
users ─┬─ wallet_accounts                     кто ты: пользователь = набор кошельков
       └─ refresh_tokens …                    сессии
groups ── group_members (user_id NULL = без кошелька)
       ├─ expenses ── expense_shares          кто платил и чьи доли
       ├─ payment_requests                    «Запросить» (Solana Pay)
       ├─ settlements ── settlement_transfers «Рассчитаться»
       ├─ payments                            переводы, найденные в сети: гасят долги
       └─ invites                             ссылки-приглашения
```

Деньги хранятся только в **целых центах доллара**. Стейблкоин равен доллару 1:1, у USDC и USDT 6 знаков, поэтому
1 цент = 10 000 минимальных единиц. **Долги не хранятся**: они считаются при каждом чтении из долей в расходах
минус найденные переводы (`groups/ledger.ts`), так что расходиться им не с чем.

## Документы

| Документ                                                        | О чём                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [auth-and-security.md](architecture/auth-and-security.md)       | Вход по подписи, JWT и refresh, CSRF/CORS, лимиты, заголовки, конфиг      |
| [groups-and-expenses.md](architecture/groups-and-expenses.md)   | Группы, участники, расходы, журнал долгов, главная                        |
| [invites.md](architecture/invites.md)                           | Общие и персональные приглашения                                          |
| [payments.md](architecture/payments.md)                         | Запросы Solana Pay, оплата со страницы, «Рассчитаться», сверка в сети     |
| [database.md](architecture/database.md)                         | Таблицы, ключи и индексы, миграции                                        |
| [transfers-and-events.md](architecture/transfers-and-events.md) | Переводы мимо Divra (LaserStream gRPC), события для фронтенда (WebSocket) |
| [testing.md](architecture/testing.md)                           | Юнит и e2e, PGlite, подмена сети Solana, как писать новый тест            |

Контракт с фронтендом — zod-схемы в `frontend/src/shared/api/*/schemas.ts`. Ответы бэкенда должны им
соответствовать: фронт проверяет каждый ответ и считает несовпадение ошибкой.

## Журнал решений

| #   | Решение                                                                                                                                                                                      | Почему                                                                                       | Подробно                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Вход — подпись одноразовой memo-транзакции (домен, адрес, сеть, nonce, срок); второй подписант — ключ без приватной части                                                                    | Кошельки умеют подписывать транзакции везде; такую транзакцию невозможно отправить в сеть    | [auth-and-security.md](architecture/auth-and-security.md)       |
| 2   | Вызов гасится условным `UPDATE … WHERE used_at IS NULL` до проверки подписи; любая ошибка — одинаковый 401                                                                                   | Нет повтора, перебора и гонок; нет подсказок атакующему                                      | [auth-and-security.md](architecture/auth-and-security.md)       |
| 3   | Access JWT на 15 минут в памяти клиента; refresh одноразовый, с ротацией и отзывом семейства при повторе, только в HttpOnly SameSite=Strict cookie                                           | Долгоживущий секрет недоступен из JS; кражу refresh видно по повторному использованию        | [auth-and-security.md](architecture/auth-and-security.md)       |
| 4   | Cookie-эндпоинты: обязательный `X-Divra-Client` + проверка `Origin`/`Sec-Fetch-Site`; CORS только `APP_ORIGIN`                                                                               | Защита от CSRF поверх SameSite, в том числе login CSRF                                       | [auth-and-security.md](architecture/auth-and-security.md)       |
| 5   | Конфиг — zod; в production приложение не стартует с секретом из примера, без Secure-cookie или без https                                                                                     | Ошибка конфигурации, ослабляющая защиту, — отказ, а не предупреждение                        | [auth-and-security.md](architecture/auth-and-security.md)       |
| 6   | Пользователь = набор кошельков (`wallet_accounts`), без email и пароля                                                                                                                       | Личность — ключ; персональных данных сверх нужного не храним                                 | [database.md](architecture/database.md)                         |
| 7   | Чужая, несуществующая группа и кривой id — один и тот же 404                                                                                                                                 | Перебором не узнать, какие группы существуют                                                 | [groups-and-expenses.md](architecture/groups-and-expenses.md)   |
| 8   | Участник без кошелька — строка `group_members` с `user_id = NULL`                                                                                                                            | Расходы можно вести до того, как друг подключился                                            | [groups-and-expenses.md](architecture/groups-and-expenses.md)   |
| 9   | Имена людей: NFC, без управляющих и bidi-символов, уникальны в группе без учёта регистра                                                                                                     | Невозможно подделать имя переворотом текста или невидимыми символами                         | [groups-and-expenses.md](architecture/groups-and-expenses.md)   |
| 10  | Деньги — целые центы; больше двух знаков после запятой — 400, а не округление                                                                                                                | Никаких 0.1 + 0.2; ошибка клиента видна сразу                                                | [groups-and-expenses.md](architecture/groups-and-expenses.md)   |
| 11  | Участник из другой группы невозможен на уровне БД: составные внешние ключи `(group_id, member_id)`                                                                                           | Защита от ошибок в коде, а не только проверка в сервисе                                      | [database.md](architecture/database.md)                         |
| 12  | Долги не хранятся, а считаются из расходов и найденных переводов, встречно зачитываются по парам                                                                                             | Нечему разойтись с исходными данными                                                         | [groups-and-expenses.md](architecture/groups-and-expenses.md)   |
| 13  | Исходная сумма и курс в расходе должны давать ту же сумму в долларах (±1 цент)                                                                                                               | Нельзя показать «10 000 ₸», а записать $1000                                                 | [groups-and-expenses.md](architecture/groups-and-expenses.md)   |
| 14  | Лимиты (100 групп, 50 участников) проверяются под блокировкой строки                                                                                                                         | Параллельные запросы их не обходят                                                           | [groups-and-expenses.md](architecture/groups-and-expenses.md)   |
| 15  | Приглашение: код 128 бит, 7 дней; персональное забирается один раз под блокировками                                                                                                          | Не подобрать; одного участника не заберут двое                                               | [invites.md](architecture/invites.md)                           |
| 16  | Сумму запроса считает сервер; получатель — только свой кошелёк                                                                                                                               | Нельзя запросить больше долга или перенаправить чужой долг                                   | [payments.md](architecture/payments.md)                         |
| 17  | Оплата засчитывается только после поиска в сети: успешная транзакция с `reference`, рост баланса нужного токена у получателя на всю сумму                                                    | Divra не верит клиенту на слово и не держит деньги                                           | [payments.md](architecture/payments.md)                         |
| 18  | Один действующий запрос на пару «кто просит → кто должен»; новая сумма заменяет старый запрос                                                                                                | Нет дублей; старая ссылка не принимает оплату, но пришедший по ней перевод засчитывается     | [payments.md](architecture/payments.md)                         |
| 19  | Оплата со страницы: бэкенд собирает перевод, кошелёк подписывает, бэкенд отправляет только транзакцию с reference и аккаунтом получателя                                                     | Расширения на компьютере не открывают `solana:`; эндпоинт — не ретранслятор чужих транзакций | [payments.md](architecture/payments.md)                         |
| 20  | «Рассчитаться» — одна транзакция на всех; засчитываются только переводы, которые сеть реально провела                                                                                        | Одна подпись; частичный успех не превращается в погашение всех долгов                        | [payments.md](architecture/payments.md)                         |
| 21  | `payments (signature, to_member_id)` уникальна                                                                                                                                               | Один перевод не погасит долг дважды — ни двумя запросами, ни запросом и расчётом             | [database.md](architecture/database.md)                         |
| 22  | Поиск оплат — при открытии страницы (не чаще раза в 10 с) и фоновым таймером в процессе                                                                                                      | Друг может закрыть страницу сразу после перевода                                             | [payments.md](architecture/payments.md)                         |
| 23  | Вся работа с сетью Solana — за абстрактными классами; в e2e они подменяются                                                                                                                  | Тесты быстрые и детерминированные, без сети                                                  | [testing.md](architecture/testing.md)                           |
| 24  | e2e на PGlite с настоящими миграциями                                                                                                                                                        | Тот же SQL и ограничения, что в PostgreSQL, без установки базы                               | [testing.md](architecture/testing.md)                           |
| 25  | Расход правит и удаляет автор (`created_by`) или плательщик; правка заменяет доли целиком под блокировкой группы                                                                             | Ошибку исправляет тот, кто её внёс или заплатил; чужие расходы не переписать                 | [groups-and-expenses.md](architecture/groups-and-expenses.md)   |
| 26  | Выход и удаление участника — мягкие (`left_at`, `user_id → NULL`), только без долгов в обе стороны; участника с кошельком выгнать нельзя                                                     | На строку ссылаются старые расходы; уход не меняет журнал долгов                             | [groups-and-expenses.md](architecture/groups-and-expenses.md)   |
| 27  | Уникальность имени в группе — частичный индекс `where left_at is null`                                                                                                                       | Имя ушедшего освобождается                                                                   | [database.md](architecture/database.md)                         |
| 28  | Отзыв приглашения (`revoked_at`) доступен любому участнику; при удалении участника его персональные ссылки отзываются                                                                        | Отзыв только закрывает доступ — права не нужны                                               | [invites.md](architecture/invites.md)                           |
| 29  | Отмена запроса ставит `cancelled_at` и `replaced_at`: запрос перестаёт быть действующим, но пришедший по нему перевод засчитывается                                                          | Один механизм для замены, отмены и выхода из группы                                          | [payments.md](architecture/payments.md)                         |
| 30  | Напоминание — текст со ссылкой, который пользователь отправляет сам; `last_reminded_at` обновляется атомарно, не чаще раза в сутки                                                           | Без сбора контактов и своей рассылки; спамить должника нельзя                                | [payments.md](architecture/payments.md)                         |
| 31  | Наличные — строка `payments` с `method = 'cash'` (без `signature` и `token`), записывает только получатель, не больше долга под блокировкой группы                                           | Долг гасится вне сети честно: должник сам себе долг не закроет                               | [payments.md](architecture/payments.md)                         |
| 32  | Удаление аккаунта: пользователь и кошельки удаляются, участники остаются без кошелька, открытые запросы отменяются, refresh-токены отзываются явно                                           | Долги друзей не ломаются; удалённый не продолжает сессию                                     | [auth-and-security.md](architecture/auth-and-security.md)       |
| 33  | Имя профиля заменяет имена по умолчанию (короткий адрес, прежнее имя профиля) во всех группах; занято — с номером                                                                            | Имя задаётся один раз; ручные имена не трогаем                                               | [auth-and-security.md](architecture/auth-and-security.md)       |
| 34  | Переводы мимо Divra замечаются потоком LaserStream (gRPC Helius) по токен-аккаунтам участников; набор меняется в том же потоке, без переподключения                                          | Мгновенно и без опроса RPC по каждому кошельку                                               | [transfers-and-events.md](architecture/transfers-and-events.md) |
| 35  | Замеченный перевод — только подсказка; засчитывает получатель, после повторной сверки транзакции через RPC, не больше долга                                                                  | Divra не знает, за что перевод; потоку на слово не верим                                     | [transfers-and-events.md](architecture/transfers-and-events.md) |
| 36  | События для фронтенда — socket.io (только WebSocket) на `/api/socket.io`, токен в handshake, проверка Origin, комнаты по пользователю                                                        | Готовая библиотека с переподключением; без sticky-сессий; защита от CSWSH                    | [transfers-and-events.md](architecture/transfers-and-events.md) |
| 37  | События тонкие (`group.changed`, `transfer.detected`) — клиент перечитывает данные обычными запросами                                                                                        | Один источник данных и одни проверки доступа                                                 | [transfers-and-events.md](architecture/transfers-and-events.md) |
| 38  | Без `HELIUS_API_KEY` поток выключен, приложение работает как раньше                                                                                                                          | Функция необязательная; разработка без ключа                                                 | [transfers-and-events.md](architecture/transfers-and-events.md) |
| 39  | Поток индексирует все переводы стейблкоина с участием пользователей Divra в `chain_transfers` — источник «Истории»; засчитанные оплаты в сети (`payments`) дополняют её, если потока не было | История видна полностью, а не только переводы, засчитанные в долги                           | [transfers-and-events.md](architecture/transfers-and-events.md) |
| 40  | «История» — курсорная пагинация по `(created_at, id)`; курсор хранит время с точностью Postgres                                                                                              | Нет пропусков и повторов при новых переводах, в отличие от offset                            | [transfers-and-events.md](architecture/transfers-and-events.md) |
