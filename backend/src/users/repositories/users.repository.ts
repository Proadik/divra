import type {
  AuthUser,
  UserProfile,
  WalletAccount,
} from '../user.interface.js';

export abstract class UsersRepository {
  /** Пользователь по id; undefined — удалён (тогда токен отклоняется) */
  abstract findById(id: string): Promise<AuthUser | undefined>;
  /**
   * Вход кошельком: находит владельца адреса или регистрирует нового пользователя
   * с этим кошельком. Атомарно: два одновременных первых входа дают одного пользователя.
   */
  abstract signInWithWallet(
    wallet: WalletAccount,
  ): Promise<{ user: AuthUser; created: boolean }>;
  abstract getProfile(id: string): Promise<UserProfile | undefined>;
}
