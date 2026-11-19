# Вход, сессии и защита API

Код: `src/auth/`, `src/users/`, `src/bootstrap.ts`, `src/config/`, `src/common/filters/`.
Клиентская сторона — [frontend/docs/architecture/wallet-verification.md](../../../frontend/docs/architecture/wallet-verification.md).

## Поток входа

```
POST /api/auth/wallet/challenge { address }       → { challengeId, transaction (base64), …, expiresAt }
   кошелёк подписывает транзакцию (signTransaction, без отправки)
POST /api/auth/wallet/verify { challengeId, signedTransaction }
                                                  → { accessToken, user }, Set-Cookie: refresh
POST /api/auth/refresh   (cookie)                 → новый accessToken, новый refresh
POST /api/auth/sign-out  (cookie)                 → refresh этого устройства отозван
```

Транзакция-вызов (`src/auth/solana/challenge-transaction.ts`) — memo с доменом фронтенда (`APP_ORIGIN`),
адресом, сетью, nonce и сроком. Второй обязательный подписант — случайный ключ без приватной части, поэтому
подписанную транзакцию **невозможно отправить в сеть**. Blockhash берётся из `BlockhashSource` (в тестах — фейк).

## Правила проверки

- Вызов одноразовый, живёт `CHALLENGE_TTL_SECONDS` (5 минут). Он гасится первой же попыткой одной условной
  записью `UPDATE … WHERE used_at IS NULL` до проверки подписи. Повтор, перебор и гонка невозможны.
- Подпись проверяется над **ровно теми байтами**, что выдал сервер (в БД хранится SHA-256 сообщения). Если кошелёк
  добавил инструкции ComputeBudget, сообщение разбирается: тот же плательщик, тот же blockhash, ровно один memo с
  выданным текстом, других программ нет.
- Подпись, сделанная для чужого сайта, адреса или сети, не пройдёт: всё это есть в тексте.
- На любую ошибку проверки ответ один — 401, без подсказок, что не так.
- Пользователь — набор кошельков (`users` + `wallet_accounts`). Первый вход с новым адресом создаёт пользователя.

## Токены

- **Access** — JWT HS256 (`typ: at+jwt`), `ACCESS_TOKEN_TTL` (15 минут). Проверяются подпись, `exp`, `iss`, `aud`;
  `alg: none` не принимается. Ключ `JWT_SECRET` — от 32 байт. `JwtAuthProvider` дополнительно проверяет, что
  пользователь существует.
- **Refresh** — непрозрачный и одноразовый, в БД хранится только SHA-256 (`DrizzleRefreshTokenStore`). Он
  ротируется при каждом обновлении. Если предъявлен уже потраченный токен (значит, его украли), отзывается всё
  семейство (`refresh_token_family_revocations`). Абсолютный срок семейства — `REFRESH_FAMILY_TTL` (30 дней).
- Refresh лежит только в cookie `HttpOnly; SameSite=Strict; Path=/api/auth` (вне localhost ещё `Secure` и префикс
  `__Secure-`): см. `refresh-cookie.ts`. Access фронтенд держит в памяти.
- Хранилище refresh проходит официальный контракт `@nestjs/authentication/testing`
  (`test/refresh-token-store.e2e-spec.ts`).

## Профиль и удаление аккаунта

```
PATCH  /api/me { displayName }   → профиль
DELETE /api/me                   → 204, refresh-cookie стёрта
```

- **Имя профиля** (до 32 символов, те же правила, что для имён в группах). Им ты входишь в новые группы.
  В старых группах заменяются имена **по умолчанию** — короткий адрес любого твоего кошелька или прежнее
  имя профиля (в том числе с номером «… 2»); если имя занято, добавляется номер. Имя, заданное вручную, не
  трогается. Всё в одной транзакции с блокировкой участников затронутых групп.
- **Удаление аккаунта** — только с фронтенда (`BrowserRequestGuard`), лимит 5 в минуту:
  1. открытые запросы оплаты, где ты получатель, отменяются (кошелёк больше не связан с Divra);
  2. строка `users` удаляется: кошельки — каскадом, участники групп остаются с `user_id = NULL`
     (без кошелька, с тем же именем), расходы и долги друзей не меняются;
  3. `TokenService.revokeAll()` отзывает все refresh-токены (они не связаны с `users` внешним ключом);
  4. cookie стирается. Уже выданный access-токен перестаёт работать сразу: `JwtAuthProvider` не находит
     пользователя.
- Войти тем же кошельком можно снова — это будет новый пользователь без групп. Вернуть участие можно
  персональной ссылкой на «себя прежнего».

## CSRF и CORS

- `BrowserRequestGuard`: заголовок `X-Divra-Client: web`, а также `Origin` или `Sec-Fetch-Site` своего фронтенда.
  Простой кросс-сайтовый запрос такой заголовок не пришлёт, а preflight CORS пропускает только `APP_ORIGIN`.
- Под guard стоят `verify` (закрывает login CSRF), `refresh`, `sign-out`, удаление аккаунта (`DELETE /me`)
  и публичная оплата со страницы (`/payment-requests/:code/transaction|submit`).

## Прочая защита

- Лимиты (`@nestjs/throttler`): 120 запросов в минуту на IP везде, 10 в минуту на вход, не больше 5 живых
  вызовов на адрес. За прокси нужен `TRUST_PROXY`, иначе все клиенты получат один IP.
- Helmet (строгий CSP, HSTS, nosniff, запрет фреймов), тело запроса не больше 16 КБ, валидация zod через
  `strictObject` (лишние поля дают 400).
- `src/config/config.ts` проверяет окружение при старте. В production приложение не запустится с ключом из
  примера, без `Secure`-cookie или без https в `APP_ORIGIN`. Значения переменных не попадают в логи и ошибки.
- `AllExceptionsFilter` отдаёт единый формат ошибки и не раскрывает стек и SQL.

## Чего пока нет

- Досрочного отзыва access-токена (он живёт до 15 минут, поэтому TTL короткий).
- Чистки `refresh_token_family_revocations` по сроку.
