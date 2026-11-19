export type Chain = 'solana' | 'ethereum' | 'ton' | 'tron';

/** Кто вошёл — то, что получает `@CurrentUser()` */
export interface AuthUser {
  id: string;
}

export interface WalletAccount {
  chain: Chain;
  address: string;
}

/** Профиль. displayName — имя, которым ты входишь в новые группы */
export interface UserProfile {
  id: string;
  displayName: string | null;
  /** Замечать переводы мимо Divra от участников общих групп */
  detectTransfers: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  wallets: Array<WalletAccount & { createdAt: string }>;
}
