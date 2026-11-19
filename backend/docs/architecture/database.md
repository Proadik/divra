# База данных и миграции

PostgreSQL 17 (`docker-compose.yml`: `127.0.0.1:5432`, база `divra`), Drizzle ORM 1.0-rc. Схема — `src/database/schema/*.ts`
(экспорт через `index.ts`), миграции — `drizzle/`, конфиг — `drizzle.config.ts`.

## Таблицы

| Таблица                            | Файл схемы            | Что хранит                                                                                 |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `users`                            | `users.schema.ts`     | Пользователь: имя профиля, «замечать переводы мимо Divra»                                  |
| `wallet_accounts`                  | `users.schema.ts`     | Кошельки пользователя: сеть + адрес, уникальны                                             |
| `auth_challenges`                  | `auth.schema.ts`      | Вызовы на подпись: SHA-256 сообщения, срок, `used_at`                                      |
| `refresh_tokens`                   | `auth.schema.ts`      | SHA-256 refresh-токенов, семейство, срок, использован ли                                   |
| `refresh_token_family_revocations` | `auth.schema.ts`      | Отозванные семейства (после повторного предъявления токена)                                |
| `groups`                           | `groups.schema.ts`    | Группа                                                                                     |
| `group_members`                    | `groups.schema.ts`    | Участник; `user_id = NULL` — без кошелька; `left_at` — вышел или удалён                    |
| `expenses`                         | `expenses.schema.ts`  | Расход: плательщик, автор, сумма в центах, исходная валюта/сумма/курс, время правки        |
| `expense_shares`                   | `expenses.schema.ts`  | Доли расхода по участникам                                                                 |
| `invites`                          | `invites.schema.ts`   | Приглашения: код, кто пригласил, кого забрать, срок, использования, отзыв                  |
| `payment_requests`                 | `payments.schema.ts`  | «Запросить»: код, reference, сумма, срок, проверка, оплачен/заменён/отменён, напоминание   |
| `settlements`                      | `payments.schema.ts`  | «Рассчитаться»: статус, reference, подпись, срок                                           |
| `settlement_transfers`             | `payments.schema.ts`  | Переводы внутри расчёта                                                                    |
| `payments`                         | `payments.schema.ts`  | Переводы, гасящие долги: найденные в сети (`onchain`) и наличные (`cash`)                  |
| `detected_transfers`               | `transfers.schema.ts` | Переводы мимо Divra, замеченные в потоке: подсказки получателю (pending/applied/dismissed) |
| `chain_stream_state`               | `transfers.schema.ts` | Последний обработанный слот потока — с него догоняем после перезапуска                     |
| `chain_transfers`                  | `transfers.schema.ts` | Индекс переводов стейблкоина с участием пользователей Divra — источник «Истории»           |

## Правила

- **Деньги — `integer` центов.** Никаких `numeric` и `float` для сумм в долларах.
- **Связь «участник — группа» составными ключами.** У `group_members` есть `unique (group_id, id)`
  (`group_members_group_id_uq`), и все ссылки на участника идут парой `(group_id, member_id)`. Участник другой группы
  не может попасть в расход, запрос или перевод даже при ошибке в коде.
- **Мягкое удаление участников:** `left_at` вместо `DELETE` — на участника ссылаются расходы и переводы.
  Все выборки «кто в группе» фильтруют `left_at is null`.
- **Инварианты в индексах, а не только в коде:** имя среди действующих участников группы
  (`lower(display_name) where left_at is null`), один пользователь в группе
  (частичный уникальный по `user_id`), один действующий запрос на пару (`payment_requests_active_uq`), один перевод
  получателю на подпись (`payments_signature_to_uq`); у перевода в сети есть подпись и токен, у наличных —
  нет (`payments_method_ck`).
- **Гонки** решаются блокировками строк (`.for('update')`), условными `UPDATE … WHERE` для переходов статуса и
  `onConflictDoNothing` для идемпотентных вставок. Нарушение уникальности репозиторий превращает в доменную ошибку
  (`src/database/unique-violation.ts` → `UniqueViolationError`), сервис — в 409.
- Репозитории — абстрактный класс + реализация `Drizzle*`. Сервисы не пишут SQL.

## Миграции

```bash
npm run db:generate   # после правки src/database/schema: новая миграция в drizzle/
npm run db:migrate    # применить к DATABASE_URL
npm run db:studio     # Drizzle Studio: https://local.drizzle.studio
```

- **Не редактируй применённые миграции.** Любое изменение — новая миграция.
- Если drizzle-kit спрашивает, создать индекс или переименовать (в неинтерактивном режиме это ошибка), передай
  ответ флагом, например:
  `npx drizzle-kit generate --hints '[{"type":"create","kind":"index","entity":["public","payments","payments_signature_to_uq"]}]'`.
- Если новый уникальный индекс может упасть на существующих данных, допиши в миграцию SQL, который сначала
  приводит данные в порядок (пример — `drizzle/*_request_replace`).
- e2e применяют те же миграции к PGlite, поэтому сломанная миграция сразу роняет тесты.
