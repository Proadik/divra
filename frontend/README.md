# web-app boilerplate

Шаблон фронтенд-проекта: React 19 + TypeScript + Vite, архитектура Feature-Sliced Design.

## Стек

- **React 19** с React Compiler
- **TypeScript 7**
- **Vite 8**
- **React Router**: роутинг
- **oxlint** + `@stylistic`: линтинг
- **oxfmt**: форматирование
- **steiger**: проверка правил FSD
- **Vitest** + **Testing Library**: юнит- и компонентные тесты
- **Playwright**: e2e-тесты
- **lefthook** + **commitlint**: git-хуки и Conventional Commits

## Новый проект на основе шаблона

1. Создайте репозиторий через «Use this template» на GitHub или скопируйте шаблон:

   ```bash
   npx degit <user>/<repo> my-app
   cd my-app
   ```

2. Поменяйте под проект:
   - `name` в `package.json`
   - `lang`, `<title>`, мета-теги и Open Graph в `index.html`
   - `public/manifest.webmanifest`, `public/robots.txt`, `public/sitemap.xml`
   - `public/favicon.svg`

3. Настройте окружение:

   ```bash
   nvm use
   cp .env.example .env.local
   ```

4. Установите зависимости и запустите:

   ```bash
   git init
   npm i
   npm run dev
   ```

   Git-хуки ставятся при `npm i`, если папка уже git-репозиторий. Иначе: `npx lefthook install`.

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

## Структура

```
src/
├── app/        # инициализация: роутер, глобальные стили, точка входа
├── pages/      # страницы
├── widgets/    # крупные самостоятельные блоки UI
├── features/   # пользовательские сценарии
├── entities/   # бизнес-сущности
└── shared/     # переиспользуемый код без бизнес-логики
    ├── api/    # HTTP-клиент
    ├── config/ # переменные окружения и константы
    ├── lib/    # утилиты и хелперы
    └── ui/     # UI-кит
```

Правила FSD:

- Слой импортирует только из слоёв ниже: `app → pages → widgets → features → entities → shared`.
- Слайсы одного слоя не импортируют друг друга.
- Наружу слайс отдаёт только то, что экспортировано из его `index.ts`.
- Импорты между слоями пишутся через алиас: `import { api } from '@/shared/api'`.

`npm run lint:fsd` проверяет эти правила, CI тоже.

Подробнее: https://feature-sliced.design

## Переменные окружения

Описаны в `.env.example` и типизированы в `src/vite-env.d.ts`. В коде берутся из `@/shared/config`:

```ts
import { env } from '@/shared/config'

env.API_URL
```

Новую переменную нужно добавить в три места: `.env.example`, `src/vite-env.d.ts` и `src/shared/config/env.ts`.

## Тесты

**Юнит и компонентные (Vitest).** Файлы `*.test.ts(x)` лежат рядом с тестируемым кодом внутри `src`. Окружение — jsdom, матчеры jest-dom подключены в `src/shared/lib/test/setup.ts`.

Для компонентов, которым нужен роутер, есть хелпер:

```tsx
import { renderWithRouter } from '@/shared/lib/test'

const { user } = renderWithRouter(<MyPage />, { route: '/profile' })
await user.click(screen.getByRole('button'))
```

**e2e (Playwright).** Тесты лежат в `e2e/`. Playwright сам собирает проект и поднимает `vite preview`. Перед первым запуском установите браузер:

```bash
npx playwright install chromium
npm run test:e2e
```

## Коммиты

Формат [Conventional Commits](https://www.conventionalcommits.org/ru/): `feat: ...`, `fix: ...`, `refactor: ...`, `chore: ...`.

Перед коммитом lefthook запускает oxfmt и oxlint на изменённых файлах, а commitlint проверяет сообщение коммита.
