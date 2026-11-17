import { Module } from '@nestjs/common';
import { GroupsController, OverviewController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';
import { DrizzleExpensesRepository } from './repositories/drizzle-expenses.repository.js';
import { DrizzleGroupsRepository } from './repositories/drizzle-groups.repository.js';
import { ExpensesRepository } from './repositories/expenses.repository.js';
import { GroupsRepository } from './repositories/groups.repository.js';

@Module({
  controllers: [GroupsController, OverviewController],
  providers: [
    GroupsService,
    { provide: GroupsRepository, useClass: DrizzleGroupsRepository },
    { provide: ExpensesRepository, useClass: DrizzleExpensesRepository },
  ],
  exports: [GroupsService],
})
export class GroupsModule {}
