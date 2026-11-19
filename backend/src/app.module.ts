import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AuthenticationModule } from '@nestjs/authentication';
import { ThrottlerGuard, ThrottlerModule, minutes } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/events.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { InvitesModule } from './invites/invites.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { TransfersModule } from './transfers/transfers.module.js';
import { HealthController } from './health/health.controller.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    // Общий лимит на IP; маршруты входа ужесточают его через @Throttle
    ThrottlerModule.forRoot([{ name: 'default', ttl: minutes(1), limit: 120 }]),
    /**
     * Глобальный guard: любой маршрут без @Public() требует валидный access-токен.
     * Сессии-cookie модуля не используем: браузеру отдаём JWT, а refresh держим в своей cookie.
     */
    AuthenticationModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        accessToken: {
          key: config.JWT_SECRET,
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          ttl: config.ACCESS_TOKEN_TTL,
          type: 'at+jwt',
        },
        refreshToken: {
          ttl: config.REFRESH_TOKEN_TTL,
          absoluteTtl: config.REFRESH_FAMILY_TTL,
        },
      }),
    }),
    EventsModule,
    UsersModule,
    AuthModule,
    GroupsModule,
    PaymentsModule,
    InvitesModule,
    TransfersModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
