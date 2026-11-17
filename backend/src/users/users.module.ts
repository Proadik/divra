import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { DrizzleUsersRepository } from './repositories/drizzle-users.repository.js';
import { UsersRepository } from './repositories/users.repository.js';

@Module({
  controllers: [UsersController],
  providers: [{ provide: UsersRepository, useClass: DrizzleUsersRepository }],
  exports: [UsersRepository],
})
export class UsersModule {}
