import type { AuthUser } from './users/user.interface.js';

declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: AuthUser;
  }
}
