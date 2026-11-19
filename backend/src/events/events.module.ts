import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { DomainEvents } from './domain-events.js';
import { EventsGateway } from './events.gateway.js';

/** Шина событий — для всех модулей; шлюз отдаёт события фронтенду */
@Global()
@Module({
  imports: [UsersModule],
  providers: [DomainEvents, EventsGateway],
  exports: [DomainEvents],
})
export class EventsModule {}
