import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/** Заголовок, который ставит только наш фронтенд. Чужая форма его не пришлёт, а чужой fetch упрётся в CORS. */
export const CLIENT_HEADER = 'x-divra-client';

/**
 * Защита cookie-эндпоинтов от CSRF (в дополнение к SameSite=Strict):
 * - обязателен заголовок X-Divra-Client — простые кросс-сайтовые запросы (форма, <img>) его не шлют,
 *   а запрос с ним требует preflight, который CORS разрешает только APP_ORIGIN;
 * - если браузер прислал Origin или Sec-Fetch-Site — они должны указывать на наш фронтенд.
 * Login CSRF (вход жертвы в чужой аккаунт) закрывается тем же: verify тоже под этим guard.
 */
@Injectable()
export class BrowserRequestGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.get(CLIENT_HEADER) !== 'web') {
      throw new ForbiddenException('Запрос не от приложения');
    }
    const origin = request.get('origin');
    if (origin !== undefined && origin !== this.config.APP_ORIGIN) {
      throw new ForbiddenException('Запрос с чужого сайта');
    }
    const site = request.get('sec-fetch-site');
    if (
      site !== undefined &&
      site !== 'same-origin' &&
      site !== 'same-site' &&
      site !== 'none'
    ) {
      throw new ForbiddenException('Запрос с чужого сайта');
    }
    return true;
  }
}
