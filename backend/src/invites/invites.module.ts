import { Module } from '@nestjs/common';
import {
  GroupInvitesController,
  InvitesController,
} from './invites.controller.js';
import { InvitesRepository } from './invites.repository.js';
import { InvitesService } from './invites.service.js';

@Module({
  controllers: [GroupInvitesController, InvitesController],
  providers: [InvitesService, InvitesRepository],
})
export class InvitesModule {}
