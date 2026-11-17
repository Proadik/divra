import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ActivityView,
  ExpenseView,
  GroupMemberView,
  GroupOverview,
  GroupSummary,
  HomeOverview,
} from './group.interface.js';
import type {
  AddMemberRequest,
  CreateExpenseRequest,
  CreateGroupRequest,
} from './groups.schemas.js';
import { initialsOf } from './initials.js';
import { type DebtTotal, debtsOf, netDebts } from './ledger.js';
import {
  type ActivityRecord,
  type ExpenseRecord,
  ExpensesRepository,
} from './repositories/expenses.repository.js';
import {
  type GroupRecord,
  GroupsRepository,
  MAX_GROUPS_PER_USER,
  MAX_MEMBERS_PER_GROUP,
  type MemberRecord,
} from './repositories/groups.repository.js';

/** Сколько расходов отдаёт сводка группы и сколько событий — лента на главной */
const EXPENSES_LIMIT = 100;
const ACTIVITY_LIMIT = 5;

/** Одинаковый ответ для «нет такой группы» и «ты в ней не состоишь»: id чужих групп не угадать */
const groupNotFound = (): NotFoundException =>
  new NotFoundException('Группа не найдена');

const toDollars = (cents: number): number => cents / 100;

const memberView = (member: MemberRecord, userId: string): GroupMemberView => {
  const isMe = member.userId === userId;
  return {
    id: member.id,
    name: member.displayName,
    initials: initialsOf(member.displayName),
    isMe,
    status: member.userId ? 'active' : 'pending',
    address: isMe ? null : member.address,
  };
};

const expenseView = (expense: ExpenseRecord): ExpenseView => ({
  id: expense.id,
  title: expense.title,
  category: expense.category,
  paidById: expense.paidByMemberId,
  amount: toDollars(expense.amountCents),
  myShare: toDollars(expense.myShareCents),
  original: expense.original,
  createdAt: expense.createdAt.toISOString(),
});

const personView = (
  person: { name: string; userId: string | null },
  userId: string,
): ActivityView['actor'] => ({
  name: person.name,
  initials: initialsOf(person.name),
  isMe: person.userId === userId,
});

const activityView = (item: ActivityRecord, userId: string): ActivityView => {
  if (item.kind === 'payment') {
    return {
      id: item.id,
      type: 'payment',
      groupId: item.groupId,
      groupName: item.groupName,
      actor: personView(item.from, userId),
      counterpart: personView(item.to, userId),
      title: null,
      // Как в ленте фронтенда: получил — «+», отправил — «−»
      myDelta: toDollars(
        item.to.userId === userId ? item.amountCents : -item.amountCents,
      ),
      signature: item.signature,
      createdAt: item.createdAt.toISOString(),
    };
  }
  const paidByMe = item.payer.userId === userId;
  return {
    id: item.id,
    type: 'expense',
    groupId: item.groupId,
    groupName: item.groupName,
    actor: personView(item.payer, userId),
    counterpart: null,
    title: item.title,
    myDelta: toDollars(
      paidByMe ? item.amountCents - item.myShareCents : -item.myShareCents,
    ),
    signature: null,
    createdAt: item.createdAt.toISOString(),
  };
};

@Injectable()
export class GroupsService {
  constructor(
    private readonly groups: GroupsRepository,
    private readonly expenses: ExpensesRepository,
  ) {}

  async home(userId: string): Promise<HomeOverview> {
    const groups = await this.groups.listForUser(userId);
    const [ledgers, recent] = await Promise.all([
      this.expenses.debtTotals(groups.map((group) => group.id)),
      this.expenses.recentForUser(userId, ACTIVITY_LIMIT),
    ]);
    let owedToCents = 0;
    let owesCents = 0;
    const summaries = groups.map((group) => {
      const mine = debtsOf(
        netDebts(ledgers.get(group.id)?.totals ?? []),
        group.myMemberId,
      );
      owedToCents += mine.owedToCents;
      owesCents += mine.owesCents;
      return this.summaryOf(group, mine.balanceCents);
    });
    return {
      currency: 'USDC',
      owedToMe: toDollars(owedToCents),
      iOwe: toDollars(owesCents),
      groups: summaries,
      activity: recent.map((item) => activityView(item, userId)),
    };
  }

  async create(
    userId: string,
    input: CreateGroupRequest,
  ): Promise<GroupSummary> {
    const result = await this.groups.create(userId, input);
    if (!result.ok) {
      throw new UnprocessableEntityException(
        `Не больше ${MAX_GROUPS_PER_USER} групп`,
      );
    }
    return this.summaryOf(result.group, 0);
  }

  async overview(groupId: string, userId: string): Promise<GroupOverview> {
    const found = await this.groups.findForMember(groupId, userId);
    if (!found) {
      throw groupNotFound();
    }
    const { group, members } = found;
    const myMemberId = members.find((member) => member.userId === userId)?.id;
    if (!myMemberId) {
      throw groupNotFound();
    }
    const [ledgers, expenses] = await Promise.all([
      this.expenses.debtTotals([group.id]),
      this.expenses.listForGroup(group.id, userId, EXPENSES_LIMIT),
    ]);
    const ledger = ledgers.get(group.id);
    const mine = debtsOf(netDebts(ledger?.totals ?? []), myMemberId);
    return {
      id: group.id,
      name: group.name,
      kind: group.kind,
      currency: 'USDC',
      members: members.map((member) => memberView(member, userId)),
      myBalance: toDollars(mine.balanceCents),
      debts: mine.debts.map((debt: DebtTotal) => ({
        fromId: debt.fromId,
        toId: debt.toId,
        amount: toDollars(debt.cents),
      })),
      transfersBeforeSimplify: ledger?.transfers ?? 0,
      expenses: expenses.map(expenseView),
    };
  }

  /**
   * Состав группы и долги после зачёта — для расчётов и запросов оплаты.
   * undefined — группы нет или userId в ней не состоит.
   */
  async ledgerFor(
    groupId: string,
    userId: string,
  ): Promise<
    | {
        group: GroupRecord;
        members: MemberRecord[];
        me: MemberRecord;
        debts: DebtTotal[];
      }
    | undefined
  > {
    const found = await this.groups.findForMember(groupId, userId);
    const me = found?.members.find((member) => member.userId === userId);
    if (!found || !me) {
      return undefined;
    }
    const ledgers = await this.expenses.debtTotals([groupId]);
    return {
      ...found,
      me,
      debts: netDebts(ledgers.get(groupId)?.totals ?? []),
    };
  }

  async addMember(
    groupId: string,
    userId: string,
    input: AddMemberRequest,
  ): Promise<GroupMemberView> {
    const result = await this.groups.addPendingMember(
      groupId,
      userId,
      input.displayName,
    );
    if (result.ok) {
      return memberView(result.member, userId);
    }
    switch (result.reason) {
      case 'not-member':
        throw groupNotFound();
      case 'member-limit':
        throw new UnprocessableEntityException(
          `Не больше ${MAX_MEMBERS_PER_GROUP} участников в группе`,
        );
      case 'duplicate-name':
        throw new ConflictException(`«${input.displayName}» уже есть в группе`);
    }
  }

  async createExpense(
    groupId: string,
    userId: string,
    input: CreateExpenseRequest,
  ): Promise<ExpenseView> {
    const result = await this.expenses.create(groupId, userId, {
      title: input.title,
      category: input.category,
      paidByMemberId: input.paidById,
      amountCents: input.amount,
      splitMode: input.splitMode,
      original: input.original ?? null,
      shares: input.shares.map((share) => ({
        memberId: share.memberId,
        amountCents: share.amount,
      })),
    });
    if (result.ok) {
      return expenseView(result.expense);
    }
    if (result.reason === 'not-member') {
      throw groupNotFound();
    }
    throw new UnprocessableEntityException('Участник не из этой группы');
  }

  private summaryOf(
    group: GroupRecord & { membersCount: number },
    balanceCents: number,
  ): GroupSummary {
    return {
      id: group.id,
      name: group.name,
      kind: group.kind,
      membersCount: group.membersCount,
      myBalance: toDollars(balanceCents),
      lastActivityAt: group.lastActivityAt.toISOString(),
    };
  }
}
