export type Chain = 'solana' | 'ethereum' | 'ton' | 'tron';

/** Кто вошёл — то, что получает `@CurrentUser()` */
export interface AuthUser {
  id: string;
}

export interface WalletAccount {
  chain: Chain;
  address: string;
}

export interface UserProfile {
  id: string;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  wallets: Array<WalletAccount & { createdAt: string }>;
}
