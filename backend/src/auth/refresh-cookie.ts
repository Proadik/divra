import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../config/config.js';

/** Путь cookie: браузер отправит её только на эндпоинты входа, не на остальной API */
const COOKIE_PATH = '/api/auth';
const UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export const durationMs = (value: string): number => {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) {
    throw new Error(`Некорректная длительность: ${value}`);
  }
  return Number(match[1]) * (UNITS[match[2] ?? 'ms'] ?? 1);
};

/**
 * Refresh-токен живёт только в cookie: HttpOnly (JavaScript, а значит и XSS, его не прочитает),
 * SameSite=Strict, Secure вне localhost. Префикс __Secure- браузер не даст поставить без Secure.
 */
export const refreshCookieName = (config: AppConfig): string =>
  config.COOKIE_SECURE ? '__Secure-divra_rt' : 'divra_rt';

const options = (config: AppConfig): CookieOptions => ({
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: 'strict',
  path: COOKIE_PATH,
});

export const setRefreshCookie = (
  response: Response,
  config: AppConfig,
  token: string,
): void => {
  response.cookie(refreshCookieName(config), token, {
    ...options(config),
    maxAge: durationMs(config.REFRESH_TOKEN_TTL),
  });
};

export const clearRefreshCookie = (
  response: Response,
  config: AppConfig,
): void => {
  response.clearCookie(refreshCookieName(config), options(config));
};

export const readRefreshCookie = (
  request: Request,
  config: AppConfig,
): string | undefined => {
  const value: unknown = request.cookies?.[refreshCookieName(config)];
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    ? value
    : undefined;
};
