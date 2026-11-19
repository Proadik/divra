import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';

/**
 * Что изменилось. События тонкие: только «что и где», без данных — клиент перечитывает
 * данные обычными запросами (там же проверки доступа и схемы).
 */
export type DomainEvent =
  /** Расходы, участники, долги или запросы группы изменились */
  | { type: 'group.changed'; groupId: string }
  /** Состав групп, кошельки или настройки пользователя изменились — пересчитать подписку на переводы */
  | { type: 'membership.changed' }
  /** Замечен перевод мимо Divra — подсказка получателю */
  | { type: 'transfer.detected'; userId: string; id: string }
  /** В индекс попали новые переводы этих пользователей — «История» обновилась */
  | { type: 'history.changed'; userIds: string[] };

/**
 * Шина событий внутри процесса. Сервисы сообщают об изменениях, а WebSocket-шлюз
 * и поток переводов на них подписываются. Ошибка подписчика не ломает того, кто сообщил.
 */
@Injectable()
export class DomainEvents {
  private readonly emitter = new EventEmitter();

  emit(event: DomainEvent): void {
    this.emitter.emit('event', event);
  }

  on(listener: (event: DomainEvent) => void): () => void {
    const safe = (event: DomainEvent): void => {
      try {
        listener(event);
      } catch {
        // Подписчик сам логирует свои ошибки; источник события о них не знает
      }
    };
    this.emitter.on('event', safe);
    return () => {
      this.emitter.off('event', safe);
    };
  }
}
