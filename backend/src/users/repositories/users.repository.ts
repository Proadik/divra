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
  /**
   * Новое имя профиля. Оно же заменяет имя по умолчанию (короткий адрес или прежнее имя
   * профиля) во всех группах; занято — добавляется номер. Имена, заданные вручную, не трогает.
   */
  abstract updateDisplayName(
    id: string,
    displayName: string,
  ): Promise<UserProfile | undefined>;
  /**
   * Удаляет пользователя с кошельками. В группах он остаётся участником без кошелька
   * с тем же именем — расходы и долги остальных не ломаются. Его открытые запросы
   * оплаты отменяются. false — пользователя уже нет.
   */
  abstract deleteUser(id: string): Promise<boolean>;
  /** Включить или выключить «замечать переводы мимо Divra». false — пользователя уже нет */
  abstract setDetectTransfers(id: string, enabled: boolean): Promise<boolean>;
}
