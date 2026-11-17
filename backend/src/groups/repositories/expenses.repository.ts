import type {
  ExpenseCategory,
  FiatCurrency,
  SplitMode,
} from '../../database/schema/index.js';
import type { DebtTotal } from '../ledger.js';

export interface ExpenseRecord {
  id: string;
  title: string;
  category: ExpenseCategory;
  paidByMemberId: string;
  amountCents: number;
  /** Доля того, кто спрашивает */
  myShareCents: number;
  original: { currency: FiatCurrency; amount: number; rate: number } | null;
  createdAt: Date;
}

export interface NewExpense {
  title: string;
  category: ExpenseCategory;
  paidByMemberId: string;
  amountCents: number;
  splitMode: SplitMode;
  original: ExpenseRecord['original'];
  shares: Array<{ memberId: string; amountCents: number }>;
}

interface PersonRecord {
  name: string;
  userId: string | null;
}

/** Событие ленты «Недавнее»: расход (с плательщиком) или перевод между участниками */
export type ActivityRecord =
  | (ExpenseRecord & {
      kind: 'expense';
      groupId: string;
      groupName: string;
      payer: PersonRecord;
    })
  | {
      kind: 'payment';
      id: string;
      groupId: string;
      groupName: string;
      from: PersonRecord;
      to: PersonRecord;
      amountCents: number;
      signature: string;
      createdAt: Date;
    };

export type CreateExpenseResult =
  | { ok: true; expense: ExpenseRecord }
  | { ok: false; reason: 'not-member' | 'foreign-member' };

export abstract class ExpensesRepository {
  /**
   * Записывает расход от имени userId. Плательщик и все доли — участники этой группы,
   * userId — тоже её участник; иначе ничего не пишется.
   */
  abstract create(
    groupId: string,
    userId: string,
    expense: NewExpense,
  ): Promise<CreateExpenseResult>;

  /** Расходы группы, новые сверху, с долей userId */
  abstract listForGroup(
    groupId: string,
    userId: string,
    limit: number,
  ): Promise<ExpenseRecord[]>;

  /**
   * Сырые долги по группам: кто кому сколько центов по всем расходам (до зачёта),
   * минус найденные в сети переводы, и сколько было бы переводов без взаимозачёта
   * (пары «должник → плательщик», где долг ещё не погашен).
   */
  abstract debtTotals(
    groupIds: string[],
  ): Promise<Map<string, { totals: DebtTotal[]; transfers: number }>>;

  /** Последние расходы и переводы во всех группах userId, которые изменили его баланс */
  abstract recentForUser(
    userId: string,
    limit: number,
  ): Promise<ActivityRecord[]>;
}
