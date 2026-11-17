import { Controller, Get } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { SkipThrottle } from '@nestjs/throttler';

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
