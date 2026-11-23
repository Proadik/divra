# Состояние и данные

## Разделение

| Что                                              | Где                                                       | Почему                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Сессия кошелька: статус, кошелёк, адрес, токен   | zustand — `entities/wallet/model/wallet-session-store.ts` | Живёт дольше любого запроса, нужна роутеру и нескольким страницам, обновляется событиями расширения |
| Ответы бэкенда (вызов на подпись, сводка группы) | TanStack Query                                            | Кэш, повторы, статусы загрузки; не дублируем серверные данные в стор                                |
| Действия с кошельком (connect, sign + verify)    | `useMutation`                                             | Единые статусы `isPending / isError` для UI                                                         |
| Локальное состояние формы и шагов                | `useState`                                                | Не нужно никому, кроме компонента                                                                   |

## Сессия кошелька

```
disconnected ──connectStarted──▶ connecting ──connected──▶ connected ──verified──▶ verified
     ▲                               │                        ▲  │ accountChanged     │
     └──────── connectFailed ────────┘                        │  └ (следует за       │
     ▲                                                        │    расширением)      │
     │                                switchToWalletAccount ──┘                      │
     └──────────────────────────────── reset (выход) ────────────────────────────────┘

restoring — после перезагрузки: тихо переподключаемся и сверяем адрес
```

- В `verified` смена аккаунта или отзыв доступа **не меняют статус**: обновляется только
  `walletAccount`. Расхождение считает `selectWalletMismatch` (`'other-account'` /
  `'wallet-disconnected'` / `null`), UI показывает плашку и модалку перед подписью
  (см. [wallets.md](wallets.md#смена-кошелька-в-расширении)).
- `notice: 'account-changed'` — пояснение на `/verify`, когда пользователь сам выбрал «Войти как…».
- В localStorage (`divra.wallet-session`) пишутся только `walletId`, `account` и флаг `signedIn`. Access-токен — только в памяти, после перезагрузки его выдаёт `/auth/refresh` по HttpOnly-cookie.
  `walletAccount` не сохраняется: после перезагрузки его заново отдаёт расширение.
  При чтении данные проверяются zod-схемой: повреждённые или устаревшие значения
  отбрасываются, и приложение стартует с нуля.
- Восстановление: статус `restoring` → `useWalletSessionSync` ждёт, пока расширение
  зарегистрируется (до 3 с), вызывает `connect({ silent: true })` и записывает адрес.
  С токеном сессия остаётся `verified` в любом случае (`restored` / `restoreFailed`),
  расхождение — плашка. Без токена ошибка восстановления — сброс.

## Доступ к страницам

`app/router/SessionGate.tsx` пускает на страницу только в нужном статусе:

| Страница   | Статусы                      | Иначе                         |
| ---------- | ---------------------------- | ----------------------------- |
| `/connect` | `disconnected`, `connecting` | на «свою» страницу по статусу |
| `/verify`  | `connected`                  |                               |
| `/`        | `verified`                   |                               |

Пока `restoring`, показывается заглушка «Восстанавливаем подключение…».

## TanStack Query

- Один `QueryClient` на приложение (`app/state/QueryProvider.tsx`): `retry: 1`, без перезапросов при фокусе окна.
- Ключи запросов — фабрики рядом с API (`authKeys` в `shared/api/auth`, `groupKeys` в `shared/api/groups`).
- Сводка группы: `getGroupOverview(groupId)` → `GET /groups/:id/overview`, схема `groupOverviewSchema`.
  Суммы — числа в единицах USDC; баланс и упрощённые долги считает бэкенд, фронт только показывает.
- В тестах `renderWithRouter` создаёт свой клиент без повторов.

## zod

| Граница              | Схема                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| Переменные окружения | `shared/config/env.ts` — ошибка при старте, если env некорректен                                         |
| Запросы и ответы API | `shared/api/auth/schemas.ts`, `shared/api/groups/schemas.ts` — `parse` перед отправкой и после получения |
| localStorage         | `persistedSchema` в сторе сессии                                                                         |
| Сети                 | `chainIdSchema` в `shared/config/chains.ts`                                                              |

Типы выводятся из схем (`z.infer`), а не описываются отдельно.

## Переменные окружения

| Переменная              | По умолчанию            | Назначение                                                     |
| ----------------------- | ----------------------- | -------------------------------------------------------------- |
| `VITE_API_MOCK`         | `true`                  | Имитировать бэкенд в браузере                                  |
| `VITE_AUTH_MOCK`        | как `VITE_API_MOCK`     | Мок только для входа; `false` — настоящий JWT от `backend/`    |
| `VITE_GROUPS_MOCK`      | как `VITE_API_MOCK`     | Группы, участники, приглашения и расходы; `false` — `backend/` |
| `VITE_API_URL`          | `/api`                  | Адрес API, когда мок выключен                                  |
| `VITE_API_PROXY_TARGET` | `http://localhost:3000` | Куда dev-сервер Vite проксирует `/api`                         |
| `VITE_SOLANA_CLUSTER`   | `devnet`                | `devnet` / `testnet` / `mainnet-beta`                          |
| `VITE_SOLANA_RPC_URL`   | публичный RPC кластера  | Нужен моку для свежего blockhash                               |
| `VITE_SITE_URL`         | —                       | Абсолютные ссылки в SEO-тегах                                  |

## События с сервера

Бэкенд сообщает об изменениях через WebSocket (socket.io), чтобы экраны обновлялись сразу — например, когда друг
добавил расход или перевёл деньги. Контракт — `backend/src/events/events.gateway.ts`.

- `shared/api/events` — `connectEvents()`: `socket.io-client`, путь из `VITE_API_URL` (`/api` → `/api/socket.io`),
  только транспорт WebSocket. Access-токен передаётся в handshake (`auth`), а не в URL. Полезная нагрузка
  проверяется zod.
- `app/state/ServerEventsSync` — подключается, пока есть сессия, и переводит события в кэш:

  | Событие             | Что помечается устаревшим                                                           |
  | ------------------- | ----------------------------------------------------------------------------------- |
  | `group.changed`     | `groupKeys.all`, `paymentKeys.sent(groupId)`, `transferKeys.all`, `historyKeys.all` |
  | `transfer.detected` | `transferKeys.all`, `historyKeys.all`                                               |
  | `history.changed`   | `historyKeys.all`                                                                   |

  Данные не приходят в событии: открытые экраны сами перезапрашивают их обычными запросами (те же zod-схемы
  и проверки доступа).

- **Токен истёк** — сервер закрывает соединение; `ServerEventsSync` вызывает `refreshAccessToken()` (общий
  с HTTP-клиентом, без гонок одноразового refresh) и переподключается. Не вышло — `sessionExpired()`.
- **Мок** (`VITE_GROUPS_MOCK=true`): вместо сокета — `shared/api/mock/events`, мок сам сообщает о своих изменениях.
- **Прокси:** в dev Vite проксирует WebSocket на `/api` (`ws: true` в `vite.config.ts`); в production nginx
  должен передавать `Upgrade` и `Connection` для `/api/socket.io`.
- Без соединения всё работает как раньше: кэш групп живёт 30 секунд и обновляется при возврате на вкладку.

## История переводов

- `shared/api/history` — `getHistory({ cursor, limit })` → `{ items, nextCursor }` (`GET /me/history`), ключи
  `historyKeys.preview()` (главная) и `historyKeys.list()` (страница).
- **Главная** (`pages/home/ui/HistorySection`) — 5 последних переводов и кнопка «Все» → `/history`.
- **Страница** (`pages/history`) — `useInfiniteQuery`, `getNextPageParam: last.nextCursor`. Следующая страница
  грузится, когда невидимый блок под списком оказывается в 600px от экрана (`IntersectionObserver`); есть и кнопка
  «Показать ещё». Внизу — «Это все переводы».
- **Строка** — `entities/history` (`HistoryRow`): «От / Кому», статус (засчитано в группе / ждёт решения /
  не связано с долгами), дата, ссылка в Solscan, сумма со знаком. Строка не кнопка: внутри ссылка.
- Обновляется событиями `history.changed`, `group.changed`, `transfer.detected`.
- **Мок:** оплаты в сети из мок-базы, переводы мимо Divra и (с демо-данными) 36 старых переводов, чтобы было что
  листать. Курсор мока — смещение.
