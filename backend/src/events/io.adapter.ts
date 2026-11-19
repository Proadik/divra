import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';
import type { AppConfig } from '../config/config.js';

/** Путь WebSocket: под /api, чтобы прокси (Vite, nginx) отдавали его тем же правилом */
export const SOCKET_PATH = '/api/socket.io';

/**
 * socket.io только для нашего фронтенда. CORS socket.io защищает лишь HTTP-polling,
 * а WebSocket браузер открывает с любого сайта — поэтому Origin проверяется в allowRequest
 * (защита от cross-site WebSocket hijacking).
 */
export class DivraIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly config: AppConfig,
  ) {
    super(app);
  }

  override createIOServer(
    port: number | undefined,
    options?: ServerOptions,
  ): Server {
    return super.createIOServer(port, {
      ...(options as ServerOptions),
      path: SOCKET_PATH,
      serveClient: false,
      // Только WebSocket: без long-polling не нужны sticky-сессии за балансировщиком
      transports: ['websocket'],
      cors: { origin: [this.config.APP_ORIGIN], credentials: false },
      // Клиент шлёт только handshake; сообщения от клиента не принимаются
      maxHttpBufferSize: 4 * 1024,
      allowRequest: (request, callback) => {
        callback(null, request.headers.origin === this.config.APP_ORIGIN);
      },
    });
  }
}
