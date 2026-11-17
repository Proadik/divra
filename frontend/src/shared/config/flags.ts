/**
 * Все фича-флаги приложения. Флаг — булево значение с дефолтом, который действует,
 * пока источник (база флагов) не прислал своё значение.
 *
 * Флаги mock.* включают демо-данные. По умолчанию данных нет — приложение выглядит
 * так, как его видит новый пользователь. Откуда идут запросы (мок в браузере или
 * настоящий бэкенд), решает VITE_API_MOCK, а не флаги.
 *
 * Как добавить флаг: запись сюда. Дальше `useFlag('name')` в компонентах
 * и `isFlagOn('name')` вне React (например, в моке).
 */
export const FEATURE_FLAGS = {
  'mock.groups': {
    default: false,
    description: 'Демо-группы, расходы и участники. Выключено — пусто, как у нового пользователя',
  },
  'mock.rates': {
    default: false,
    description: 'Демо-курсы валют. Выключено — курсов нет, пересчёт только из USD',
  },
} as const satisfies Record<string, { default: boolean; description: string }>

export type FlagName = keyof typeof FEATURE_FLAGS

export const FLAG_NAMES = Object.keys(FEATURE_FLAGS) as FlagName[]

export const isFlagName = (name: string): name is FlagName => Object.hasOwn(FEATURE_FLAGS, name)
