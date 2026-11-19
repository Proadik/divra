# Тесты

```bash
npm test            # юнит: чистые функции рядом с кодом (*.spec.ts)
npm run test:e2e    # всё приложение на PGlite, своя база и сеть не нужны
npm run typecheck && npm run lint
```

## Юнит

Рядом с кодом: `src/groups/ledger.spec.ts` (зачёт долгов), `src/groups/initials.spec.ts`,
`src/auth/solana/challenge-transaction.spec.ts`, `src/payments/solana/payment-lookup.spec.ts` (разница балансов),
`src/config/config.spec.ts` (отказ стартовать с опасным конфигом). Пишутся для чистой логики без Nest и базы.

## e2e

`test/*.e2e-spec.ts`, конфиг — `vitest.config.e2e.ts` (там же `PAYMENT_WATCH_INTERVAL_MS=0`).

- `test/test-app.ts` поднимает настоящее приложение (`bootstrap`, guard'ы, фильтры) на PGlite с применёнными
  миграциями из `drizzle/` и подменяет всё сетевое:
  - `FakePaymentLookup`: `transfers`, `confirmations`, `received`, `failing` — что «нашлось» в сети;
  - `FakeTransactionSender`: `sent`, `failWith`, `peekNext()` — что отправили и что ответит сеть;
  - `FakeBalanceReader` и фиксированный `BlockhashSource`;
  - `FakeTransferStream`: `emit(tx)` — «из сети пришла транзакция», `watched` — на что подписан поток;
  - `SETTLEMENT_TIMING` с короткими интервалами.
    Возвращает `{ app, db, chain, sender, payments, settlements, stream, watcher }`.
- WebSocket-тесты: `app.listen(0)` и `socket.io-client` с `path: '/api/socket.io'`, `transports: ['websocket']`.
- `test/wallet.ts` — `createTestWallet()`: тестовые ключи и подпись транзакции-вызова; `test/session.ts` — `signIn(app)`, полный вход
  через `/auth/wallet/*`.
- `ORIGIN_HEADERS` — заголовки, которые требует `BrowserRequestGuard`; `freshIp()` — новый IP, чтобы не упереться
  в лимиты.

| Файл                              | Что покрывает                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.e2e-spec.ts`                | Вход, JWT-claims, подделка подписи, чужое сообщение, повтор и просрочка вызова, ротация и кража refresh, выход, CSRF, CORS, валидация, лимиты, заголовки |
| `refresh-token-store.e2e-spec.ts` | Официальный контракт `@nestjs/authentication/testing`, параллельные запросы                                                                              |
| `groups.e2e-spec.ts`              | Группы, участники, 404 для чужих, имена, лимиты                                                                                                          |
| `expenses.e2e-spec.ts`            | Расходы, доли, центы, исходная валюта, долги и зачёт                                                                                                     |
| `invites.e2e-spec.ts`             | Общие и персональные приглашения, гонки, сроки                                                                                                           |
| `payments.e2e-spec.ts`            | Запросы, замена, поиск оплаты, оплата со страницы, «Отправленные»                                                                                        |
| `settlements.e2e-spec.ts`         | Сборка, отправка, частичный успех, повторная отправка, балансы                                                                                           |
| `manage.e2e-spec.ts`              | Правка и удаление расходов, выход и удаление участника, отзыв ссылок, отмена и напоминание, наличные, профиль, удаление аккаунта                         |
| `transfers.e2e-spec.ts`           | Переводы мимо Divra: подписка, сопоставление, «засчитать» с перепроверкой, WebSocket-события                                                             |
| `history.e2e-spec.ts`             | «История»: источники, направление, засчитанные и ждущие решения, курсор без повторов, проверка запроса                                                   |

## Как писать новый тест

1. Взять `createTestApp()` и `signIn(app)` для каждого участника.
2. Состояние сети задать через фейки (`chain.transfers.set(reference, [...])`, `sender.failWith = new Error(...)`),
   а не моками модулей. Сбросить их в `beforeEach`.
3. Проверять и HTTP-ответ, и то, что легло в базу (`db`), если важен инвариант.
4. Для гонок — `Promise.all` из нескольких одинаковых запросов и проверка, что успешен ровно один.
