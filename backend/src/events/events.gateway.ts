import {
  Inject,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { JwtVerifier } from '@nestjs/authentication';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  type OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { Database } from '../database/database.module.js';
import { groupMembers } from '../database/schema/index.js';
import { UsersRepository } from '../users/repositories/users.repository.js';
import { type DomainEvent, DomainEvents } from './domain-events.js';

const roomOf = (userId: string): string => `user:${userId}`;

/**
 * Поток событий для фронтенда (socket.io поверх WebSocket). Клиент только слушает:
 * сообщений от него шлюз не принимает. Вход — access-токен в handshake (`auth.token`), не в URL:
 * URL попадает в логи. Когда токен истекает, соединение закрывается — клиент переподключается
 * со свежим. Каждый пользователь — в своей комнате, события адресуются по комнатам.
 *
 * События (контракт — frontend/src/shared/api/events):
 * - `group.changed` `{ groupId }` — данные группы изменились, перечитать;
 * - `transfer.detected` `{ id }` — замечен перевод мимо Divra, появилась подсказка;
 * - `history.changed` — в «Истории» новые переводы.
 */
@WebSocketGateway()
export class EventsGateway
  implements OnGatewayConnection, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EventsGateway.name);
  private readonly verifier: JwtVerifier;
  private unsubscribe: (() => void) | null = null;

  @WebSocketServer()
  private readonly server?: Server;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @InjectDrizzle() private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly events: DomainEvents,
  ) {
    this.verifier = new JwtVerifier({
      key: config.JWT_SECRET,
      algorithms: ['HS256'],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      type: 'at+jwt',
    });
  }

  onModuleInit(): void {
    this.unsubscribe = this.events.on((event) => {
      void this.forward(event).catch((error: unknown) => {
        this.logger.warn(
          `Событие не отправлено: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  async handleConnection(socket: Socket): Promise<void> {
    const { token } = socket.handshake.auth as { token?: unknown };
    try {
      if (typeof token !== 'string' || token.length > 4096) {
        throw new Error('Нет токена');
      }
      const claims = await this.verifier.verify(token);
      const user = claims.sub ? await this.users.findById(claims.sub) : null;
      if (!user) {
        throw new Error('Пользователь не найден');
      }
      await socket.join(roomOf(user.id));
      // Токен истёк — закрываем: клиент переподключится и пришлёт новый
      const expiresInMs =
        typeof claims.exp === 'number' ? claims.exp * 1000 - Date.now() : 0;
      const timer = setTimeout(
        () => socket.disconnect(true),
        Math.max(0, expiresInMs),
      );
      socket.on('disconnect', () => clearTimeout(timer));
      socket.emit('ready');
    } catch {
      // Причину не сообщаем: как и на HTTP, отказ одинаковый
      socket.emit('unauthorized');
      socket.disconnect(true);
    }
  }

  private async forward(event: DomainEvent): Promise<void> {
    if (!this.server) {
      return;
    }
    switch (event.type) {
      case 'group.changed': {
        const members = await this.db
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(
            and(
              eq(groupMembers.groupId, event.groupId),
              isNotNull(groupMembers.userId),
              isNull(groupMembers.leftAt),
            ),
          );
        const rooms = members.flatMap((member) =>
          member.userId ? [roomOf(member.userId)] : [],
        );
        if (rooms.length > 0) {
          this.server
            .to(rooms)
            .emit('group.changed', { groupId: event.groupId });
        }
        return;
      }
      case 'transfer.detected':
        this.server
          .to(roomOf(event.userId))
          .emit('transfer.detected', { id: event.id });
        return;
      case 'history.changed':
        if (event.userIds.length > 0) {
          this.server.to(event.userIds.map(roomOf)).emit('history.changed');
        }
        return;
      case 'membership.changed':
        return;
    }
  }
}
