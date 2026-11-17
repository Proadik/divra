import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthProvider } from './jwt-auth.provider.js';
import { ChallengesRepository } from './repositories/challenges.repository.js';
import { DrizzleRefreshTokenStore } from './repositories/drizzle-refresh-token.store.js';
import {
  BlockhashSource,
  RpcBlockhashSource,
} from './solana/blockhash.source.js';
import { WalletAuthService } from './wallet-auth.service.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    WalletAuthService,
    ChallengesRepository,
    DrizzleRefreshTokenStore,
    JwtAuthProvider,
    { provide: BlockhashSource, useClass: RpcBlockhashSource },
  ],
})
export class AuthModule {}
