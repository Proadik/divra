import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { CLIENT_HEADER } from './auth/browser-request.guard.js';
import type { AppConfig } from './config/config.js';
import { DivraIoAdapter } from './events/io.adapter.js';

/** HTTP-слой: одинаково для main.ts и e2e-тестов */
export const configureApp = (
  app: NestExpressApplication,
  config: AppConfig,
): void => {
  app.setGlobalPrefix('api');
  // Реальный IP клиента за балансировщиком — иначе rate limit считает всех одним
  app.set('trust proxy', config.TRUST_PROXY);
  // API отдаёт только JSON: строгий CSP, запрет фреймов, HSTS
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    }),
  );
  app.use(cookieParser());
  // Подписанная транзакция — около 2 КБ в base64: большие тела не принимаем вовсе
  app.useBodyParser('json', { limit: '16kb' });
  app.enableCors({
    // Массив, а не строка: чужому Origin заголовок Access-Control-Allow-Origin не отдаётся вовсе
    origin: [config.APP_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization', CLIENT_HEADER],
    maxAge: 600,
  });
  // События для фронтенда — socket.io на /api/socket.io, только с нашего Origin
  app.useWebSocketAdapter(new DivraIoAdapter(app, config));
  app.enableShutdownHooks();
};
