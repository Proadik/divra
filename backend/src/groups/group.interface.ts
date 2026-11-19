import type {
  ExpenseCategory,
  FiatCurrency,
  GroupKind,
  SplitMode,
} from '../database/schema/index.js';

/**
 * Ответы API групп. Контракт — zod-схемы фронтенда (frontend/src/shared/api/groups/schemas.ts).
 * Всё, что начинается с my / isMe, считается для того, кто спрашивает.
 * Суммы — числом в долларах (USDC), внутри считаем в центах.
 */
export interface GroupSummary {
  id: string;
  name: string;
  kind: GroupKind;
  membersCount: number;
  myBalance: number;
  lastActivityAt: string;
}

export interface HomeOverview {
  currency: 'USDC';
  owedToMe: number;
  iOwe: number;
  groups: GroupSummary[];
  activity: ActivityView[];
}

export interface GroupMemberView {
  id: string;
  name: string;
  initials: string;
  isMe: boolean;
  status: 'active' | 'pending';
  /** Куда переводить: у себя и у pending — null */
  address: string | null;
}

export interface GroupOverview {
  id: string;
  name: string;
  kind: GroupKind;
  currency: 'USDC';
  members: GroupMemberView[];
  myBalance: number;
  debts: Array<{ fromId: string; toId: string; amount: number }>;
  transfersBeforeSimplify: number;
  expenses: ExpenseView[];
}

export interface ExpenseView {
  id: string;
  title: string;
  category: ExpenseCategory;
  paidById: string;
  amount: number;
  myShare: number;
  original: { currency: FiatCurrency; amount: number; rate: number } | null;
  createdAt: string;
  /** Можешь ли ты править и удалять: ты автор или плательщик */
  canEdit: boolean;
}

/** Расход для формы правки */
export interface ExpenseDetailView extends ExpenseView {
  splitMode: SplitMode;
  shares: Array<{ memberId: string; amount: number }>;
  updatedAt: string | null;
}

export interface PersonView {
  name: string;
  initials: string;
  isMe: boolean;
}

/** Событие ленты «Недавнее»: расход, перевод в сети или наличные */
export interface ActivityView {
  id: string;
  type: 'expense' | 'payment' | 'cash';
  groupId: string;
  groupName: string;
  actor: PersonView;
  counterpart: PersonView | null;
  title: string | null;
  myDelta: number;
  /** Перевод: подпись транзакции в сети; у расхода null */
  signature: string | null;
  createdAt: string;
}
