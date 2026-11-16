export const env = {
  APP_TITLE: import.meta.env.VITE_APP_TITLE,
  API_URL: import.meta.env.VITE_API_URL,
  MODE: import.meta.env.MODE,
  IS_DEV: import.meta.env.DEV,
  IS_PROD: import.meta.env.PROD,
} as const
