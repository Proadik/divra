/**
 * Имитация API групп. Начальные данные — как в макетах «A · Главная» и «A · Группа».
 *
 * Состояние хранится в localStorage (`divra.mock-db`), поэтому переживает перезагрузку
 * и общее для всех вкладок одного браузера. Сбросить — кнопкой в Настройках → Фича-флаги.
 *
 * Флаг mock.groups выбирает базу: включён — демо-данные (`divra.mock-db`), выключен — отдельная
 * пустая база (`divra.mock-db:empty`), как у нового пользователя. Изменения в каждой сохраняются.
 *
 * Код приглашения в моке самодостаточный: в нём зашиты группа, участник и срок.
 * Поэтому ссылка открывается и в другом браузере (инкогнито, телефон), где своей базы нет.
 * У настоящего бэкенда код — просто случайная строка, данные лежат на сервере.
 */

import { type FiatCurrency, stablecoinMint } from '@/shared/config'
import { isFlagOn } from '@/shared/lib/feature-flags'
import { ApiError } from '../client'
import { buildMemoTransaction, randomReference, verifySignedTransaction } from './solana'

type Category = 'transport' | 'housing' | 'food' | 'groceries' | 'fun' | 'other'
type GroupKind = 'trip' | 'home' | 'food' | 'other'

type StoredExpense = {
  id: string
  title: string
  category: Category
  paidById: string
  amount: number
  myShare: number
  original?: { currency: FiatCurrency; amount: number; rate: number } | null
  createdAt: string
}

type StoredPayment = {
  id: string
  fromId: string
  toId: string
  amount: number
  createdAt: string
}

type StoredMember = {
  id: string
  name: string
  initials: string
  isMe: boolean
  status: 'pending' | 'active'
  /** Адрес кошелька; у старых записей поля нет — берём из DEMO_ADDRESSES */
  address?: string | null
}

type StoredRequest = {
  code: string
  groupId: string
  memberId: string
  createdAt: string
}

type StoredGroup = {
  id: string
  name: string
  kind: GroupKind
  createdAt: string
  members: StoredMember[]
  /** Кто кому сколько должен, в центах: ключ `from>to` */
  ledger: Array<[string, number]>
  transfersBeforeSimplify: number
  expenses: StoredExpense[]
  payments: StoredPayment[]
}

type StoredInvite = {
  code: string
  groupId: string
  claimMemberId: string | null
  claimMemberName: string | null
  expiresAt: number
}

type MockDb = {
  version: 3
  groups: StoredGroup[]
  invites: StoredInvite[]
  /** Запросы на оплату — чтобы показать «запрос вчера» */
  requests?: StoredRequest[]
}

/** Как выглядела база до появления нескольких групп — переносим в «Бурабай» */
type MockDbV2 = {
  version: 2
  members: StoredMember[]
  invites: StoredInvite[]
  ledger: Array<[string, number]>
  transfersBeforeSimplify: number
  expenses: StoredExpense[]
}

const ME = 'me'
/** Демо-кошельки участников. Адреса случайные, в сети за ними ничего нет. */
const DEMO_ADDRESSES: Record<string, string> = {
  dana: 'En8us9A5d7H27SRP57bwt3Cv63Z57q34DkcLh5Vs1KFY',
  timur: '9TUWQuE2YXwyiBgdKsj4cNZepoPGSqHathf8bUyjBzrf',
  aigerim: '4C3dkZePK4FdgppjLpca4BrpkefyTqmhvXHSLnwWJVcU',
  arman: 'AGUe5NGSnUS5p8k9Q3HU3PQYQAyhe5oyXyVg7fDXaT1u',
  ermek: '8wbwCK3QSTiurKBGjjkCw9iVSu25aEYRhruWfcRSJKYw',
}
/** Как зовут пользователя мока в чужих глазах (в приглашениях и запросах) */
const MY_NAME = 'Адиль'
const REQUEST_TTL_MS = 14 * 24 * 3_600_000
const MAIN_GROUP = 'burabay'
/** Так называлась единственная группа раньше: старые ссылки-приглашения ведут сюда */
const LEGACY_GROUP = 'current'
const INVITE_TTL_MS = 7 * 24 * 3_600_000
const STORAGE_KEY = 'divra.mock-db'
const EMPTY_STORAGE_KEY = 'divra.mock-db:empty'

const withDemo = (): boolean => isFlagOn('mock.groups')
const storageKey = (): string => (withDemo() ? STORAGE_KEY : EMPTY_STORAGE_KEY)

const emptyDb = (): MockDb => ({ version: 3, groups: [], invites: [] })

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString()

const cents = (value: number): number => Math.round(value * 100)

const fail = (status: number, message: string): never => {
  throw new ApiError(status, { message }, message)
}

/** «Ержан» → «Е», «Анна Ли» → «АЛ» */
const initialsOf = (name: string): string => {
  const [first = '', second = ''] = name.trim().split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
}

const member = (id: string, name: string, initials = initialsOf(name)): StoredMember => ({
  id,
  name,
  initials,
  isMe: id === ME,
  status: 'active',
})

/** Адрес кошелька участника: у себя — нет (платишь с кошелька сессии), у pending — нет */
const addressOf = (item: StoredMember): string | null => {
  if (item.isMe || item.status !== 'active') {
    return null
  }
  return item.address ?? DEMO_ADDRESSES[item.id] ?? null
}

const publicMember = (item: StoredMember): StoredMember & { address: string | null } => ({
  ...item,
  address: addressOf(item),
})

const me = (): StoredMember => member(ME, 'Ты', 'А')

const burabay = (): StoredGroup => ({
  id: MAIN_GROUP,
  name: 'Алматы → Бурабай',
  kind: 'trip',
  createdAt: hoursAgo(60),
  members: [
    me(),
    member('dana', 'Дана'),
    member('timur', 'Тимур'),
    member('aigerim', 'Айгерим', 'Ай'),
  ],
  ledger: [
    ['timur>me', 3200],
    ['aigerim>me', 2870],
    ['me>dana', 1250],
  ],
  transfersBeforeSimplify: 7,
  expenses: [
    {
      id: 'e1',
      title: 'Бензин до Бурабая',
      category: 'transport',
      paidById: 'timur',
      amount: 84,
      myShare: 21,
      createdAt: hoursAgo(2),
    },
    {
      id: 'e2',
      title: 'Кофе на заправке',
      category: 'food',
      paidById: 'aigerim',
      amount: 18,
      myShare: 4.5,
      createdAt: hoursAgo(3),
    },
    {
      id: 'e3',
      title: 'Домик у озера',
      category: 'housing',
      paidById: ME,
      amount: 240,
      myShare: 60,
      createdAt: hoursAgo(26),
    },
    {
      id: 'e4',
      title: 'Шашлык',
      category: 'food',
      paidById: 'dana',
      amount: 50,
      myShare: 12.5,
      createdAt: hoursAgo(28),
    },
    {
      id: 'e5',
      title: 'Продукты в Magnum',
      category: 'groceries',
      paidById: 'aigerim',
      amount: 64.4,
      myShare: 16.1,
      createdAt: hoursAgo(30),
    },
    {
      id: 'e6',
      title: 'Прокат лодки',
      category: 'fun',
      paidById: ME,
      amount: 96,
      myShare: 24,
      createdAt: hoursAgo(50),
    },
    {
      id: 'e7',
      title: 'Дрова и уголь',
      category: 'other',
      paidById: 'timur',
      amount: 22,
      myShare: 0,
      createdAt: hoursAgo(52),
    },
  ],
  payments: [],
})

const seed = (): MockDb => ({
  version: 3,
  invites: [],
  groups: [
    burabay(),
    {
      id: 'abaya',
      name: 'Квартира на Абая',
      kind: 'home',
      createdAt: hoursAgo(24 * 40),
      members: [me(), member('dana', 'Дана'), member('arman', 'Арман')],
      ledger: [
        ['me>dana', 1500],
        ['me>arman', 1000],
      ],
      transfersBeforeSimplify: 3,
      expenses: [
        {
          id: 'a1',
          title: 'Интернет и свет',
          category: 'housing',
          paidById: 'dana',
          amount: 45,
          myShare: 15,
          createdAt: hoursAgo(20),
        },
        {
          id: 'a2',
          title: 'Бытовая химия',
          category: 'groceries',
          paidById: 'arman',
          amount: 30,
          myShare: 10,
          createdAt: hoursAgo(70),
        },
      ],
      payments: [],
    },
    {
      id: 'friday',
      name: 'Ужин в пятницу',
      kind: 'food',
      createdAt: hoursAgo(24 * 6),
      members: [
        me(),
        member('dana', 'Дана'),
        member('timur', 'Тимур'),
        member('aigerim', 'Айгерим', 'Ай'),
        member('ermek', 'Ермек'),
      ],
      ledger: [],
      transfersBeforeSimplify: 4,
      expenses: [
        {
          id: 'f1',
          title: 'Ужин в ресторане',
          category: 'food',
          paidById: ME,
          amount: 150,
          myShare: 30,
          createdAt: hoursAgo(24 * 5),
        },
      ],
      payments: [
        { id: 'p1', fromId: 'aigerim', toId: ME, amount: 30, createdAt: hoursAgo(25) },
        { id: 'p2', fromId: 'timur', toId: ME, amount: 30, createdAt: hoursAgo(24 * 3) },
        { id: 'p3', fromId: 'dana', toId: ME, amount: 30, createdAt: hoursAgo(24 * 4) },
        { id: 'p4', fromId: 'ermek', toId: ME, amount: 30, createdAt: hoursAgo(24 * 4 + 2) },
      ],
    },
  ],
})

const migrate = (old: MockDbV2): MockDb => {
  const db = seed()
  db.invites = old.invites
  const main = db.groups.find((group) => group.id === MAIN_GROUP)
  if (main) {
    Object.assign(main, {
      members: old.members,
      ledger: old.ledger,
      transfersBeforeSimplify: old.transfersBeforeSimplify,
      expenses: old.expenses,
    })
  }
  return db
}

/** Читаем базу заново на каждый запрос: другая вкладка могла её изменить. */
const load = (): MockDb => {
  try {
    const raw = localStorage.getItem(storageKey())
    const parsed = raw ? (JSON.parse(raw) as Partial<MockDb> | Partial<MockDbV2>) : null
    if (parsed?.version === 3 && Array.isArray(parsed.groups)) {
      return parsed as MockDb
    }
    if (parsed?.version === 2 && Array.isArray(parsed.members) && Array.isArray(parsed.expenses)) {
      return migrate(parsed as MockDbV2)
    }
  } catch {
    // Повреждённые данные — начинаем с начальных
  }
  return withDemo() ? seed() : emptyDb()
}

const save = (db: MockDb): void => {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(db))
  } catch {
    // Нет доступа к storage — работаем только в памяти
  }
}

const findGroup = (db: MockDb, groupId: string): StoredGroup => {
  const id = groupId === LEGACY_GROUP ? MAIN_GROUP : groupId
  return db.groups.find((group) => group.id === id) ?? fail(404, 'Группа не найдена')
}

// ── Самодостаточный код приглашения (только для мока) ───────────────────────

type InvitePayload = { g: string; m: string | null; n: string | null; e: number }

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const fromBase64Url = (value: string): Uint8Array => {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (char) =>
    char.charCodeAt(0),
  )
}

/** 8 случайных символов + данные приглашения в base64url */
const encodeInvite = (payload: InvitePayload): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(6))) +
  toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))

const decodeInvite = (code: string): StoredInvite | null => {
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(code.slice(8))),
    ) as InvitePayload
    if (typeof payload.g !== 'string' || typeof payload.e !== 'number') {
      return null
    }
    return {
      code,
      groupId: payload.g,
      claimMemberId: payload.m,
      claimMemberName: payload.n,
      expiresAt: payload.e * 1000,
    }
  } catch {
    return null
  }
}

/** Тот же приём для запросов на оплату: данные зашиты в код, ссылка открывается где угодно */
const packCode = (payload: object): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(6))) +
  toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))

const unpackCode = (code: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(code.slice(8))))
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

type RequestPayload = {
  /** группа */ g: string
  /** название группы */ gn: string
  /** от кого (имя) */ f: string
  /** куда платить */ a: string
  /** кому адресован (имя) */ t: string
  /** сумма */ s: number
  /** токен */ k: 'USDC' | 'USDT'
  /** сообщение */ m: string
  /** reference для Solana Pay */ r: string
  /** истекает, unix-секунды */ e: number
}

const solanaPayUrl = (payload: RequestPayload, mint: string): string => {
  const params = new URLSearchParams({
    amount: payload.s.toFixed(2),
    'spl-token': mint,
    reference: payload.r,
    label: 'Divra',
    message: payload.m || `${payload.gn}: долг ${payload.t}`,
  })
  return `solana:${payload.a}?${params.toString()}`
}

type PendingSettlement = {
  groupId: string
  payer: string
  token: 'USDC' | 'USDT'
  transfers: Array<{ memberId: string; name: string; address: string; amount: number }>
  total: number
  expiresAt: number
}

/** Собранные, но ещё не подписанные переводы. Живут в памяти вкладки, как вызовы входа. */
const pendingSettlements = new Map<string, PendingSettlement>()
const SETTLEMENT_TTL_MS = 2 * 60_000

const findInvite = (db: MockDb, code: string): StoredInvite => {
  const invite = db.invites.find((item) => item.code === code) ?? decodeInvite(code)
  if (!invite) {
    return fail(404, 'Приглашение не найдено')
  }
  if (invite.expiresAt < Date.now()) {
    return fail(410, 'Срок приглашения истёк')
  }
  return invite
}

// ── Долги ───────────────────────────────────────────────────────────────────

/** from должен to ещё amountCents — с зачётом встречного долга. */
const addDebt = (group: StoredGroup, from: string, to: string, amountCents: number): void => {
  const ledger = new Map(group.ledger)
  const reverseKey = `${to}>${from}`
  const reverse = ledger.get(reverseKey) ?? 0
  if (reverse >= amountCents) {
    ledger.set(reverseKey, reverse - amountCents)
  } else {
    ledger.delete(reverseKey)
    const key = `${from}>${to}`
    ledger.set(key, (ledger.get(key) ?? 0) + amountCents - reverse)
  }
  group.ledger = [...ledger.entries()]
}

const myDebts = (group: StoredGroup): Array<{ fromId: string; toId: string; amount: number }> =>
  group.ledger
    .map(([key, value]) => {
      const [fromId = '', toId = ''] = key.split('>')
      return { fromId, toId, amount: value / 100 }
    })
    .filter((debt) => debt.amount > 0 && (debt.fromId === ME || debt.toId === ME))

/** Баланс в центах: > 0 — тебе должны */
const balanceCents = (group: StoredGroup): number =>
  myDebts(group).reduce(
    (sum, debt) => sum + (debt.toId === ME ? cents(debt.amount) : -cents(debt.amount)),
    0,
  )

const lastActivityAt = (group: StoredGroup): string =>
  [
    group.createdAt,
    ...group.expenses.map((e) => e.createdAt),
    ...group.payments.map((p) => p.createdAt),
  ]
    .sort()
    .at(-1) ?? group.createdAt

type Person = { name: string; initials: string; isMe: boolean }

type Summary = {
  id: string
  name: string
  kind: GroupKind
  membersCount: number
  myBalance: number
  lastActivityAt: string
}

type ActivityItem = {
  id: string
  type: 'expense' | 'payment'
  groupId: string
  groupName: string
  actor: Person
  counterpart: Person | null
  title: string | null
  myDelta: number
  createdAt: string
}

const summaryOf = (group: StoredGroup): Summary => ({
  id: group.id,
  name: group.name,
  kind: group.kind,
  membersCount: group.members.length,
  myBalance: balanceCents(group) / 100,
  lastActivityAt: lastActivityAt(group),
})

const personOf = (group: StoredGroup, id: string): Person => {
  const found = group.members.find((item) => item.id === id)
  return {
    name: found?.name ?? 'Участник',
    initials: found?.initials ?? '?',
    isMe: id === ME,
  }
}

const activityOf = (group: StoredGroup): ActivityItem[] => [
  ...group.expenses.map((expense): ActivityItem => ({
    id: `${group.id}:${expense.id}`,
    type: 'expense',
    groupId: group.id,
    groupName: group.name,
    actor: personOf(group, expense.paidById),
    counterpart: null,
    title: expense.title,
    myDelta: expense.paidById === ME ? expense.amount - expense.myShare : -expense.myShare,
    createdAt: expense.createdAt,
  })),
  ...group.payments.map((payment): ActivityItem => ({
    id: `${group.id}:${payment.id}`,
    type: 'payment',
    groupId: group.id,
    groupName: group.name,
    actor: personOf(group, payment.fromId),
    counterpart: personOf(group, payment.toId),
    title: null,
    myDelta: payment.toId === ME ? payment.amount : payment.fromId === ME ? -payment.amount : 0,
    createdAt: payment.createdAt,
  })),
]

// ── API ─────────────────────────────────────────────────────────────────────

const ACTIVITY_LIMIT = 5

export const mockGroupsBackend = {
  async getHome() {
    await delay(300)
    const db = load()
    const debts = db.groups.flatMap(myDebts)
    const sum = (list: typeof debts): number =>
      list.reduce((total, debt) => total + cents(debt.amount), 0) / 100
    return {
      currency: 'USDC',
      owedToMe: sum(debts.filter((debt) => debt.toId === ME)),
      iOwe: sum(debts.filter((debt) => debt.fromId === ME)),
      groups: db.groups
        .map(summaryOf)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
      activity: db.groups
        .flatMap(activityOf)
        .filter((item) => item.myDelta !== 0)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, ACTIVITY_LIMIT),
    }
  },

  async createGroup(input: { name: string; kind: GroupKind }) {
    await delay(350)
    const db = load()
    const group: StoredGroup = {
      id: `g${Date.now()}`,
      name: input.name.trim(),
      kind: input.kind,
      createdAt: new Date().toISOString(),
      members: [me()],
      ledger: [],
      transfersBeforeSimplify: 0,
      expenses: [],
      payments: [],
    }
    db.groups.push(group)
    save(db)
    return summaryOf(group)
  },

  async getOverview(groupId: string) {
    await delay(300)
    const group = findGroup(load(), groupId)
    return {
      id: group.id,
      name: group.name,
      kind: group.kind,
      currency: 'USDC',
      members: group.members.map(publicMember),
      myBalance: balanceCents(group) / 100,
      debts: myDebts(group),
      transfersBeforeSimplify: group.transfersBeforeSimplify,
      expenses: [...group.expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }
  },

  async createExpense(
    groupId: string,
    input: {
      title: string
      category: Category
      paidById: string
      amount: number
      original?: StoredExpense['original']
      shares: Array<{ memberId: string; amount: number }>
    },
  ) {
    await delay(400)
    const db = load()
    const group = findGroup(db, groupId)
    for (const share of input.shares) {
      if (share.memberId !== input.paidById && share.amount > 0) {
        addDebt(group, share.memberId, input.paidById, cents(share.amount))
        group.transfersBeforeSimplify += 1
      }
    }
    const expense: StoredExpense = {
      id: `e${Date.now()}`,
      title: input.title.trim(),
      category: input.category,
      paidById: input.paidById,
      amount: input.amount,
      myShare: input.shares.find((share) => share.memberId === ME)?.amount ?? 0,
      original: input.original ?? null,
      createdAt: new Date().toISOString(),
    }
    group.expenses.push(expense)
    save(db)
    return expense
  },

  async addMember(groupId: string, input: { displayName: string }) {
    await delay(300)
    const db = load()
    const group = findGroup(db, groupId)
    const name = input.displayName.trim()
    if (group.members.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      return fail(409, `«${name}» уже есть в группе`)
    }
    const added: StoredMember = { ...member(`m${Date.now()}`, name), status: 'pending' }
    group.members.push(added)
    save(db)
    return publicMember(added)
  },

  async createInvite(groupId: string, input: { claimMemberId?: string }) {
    await delay(250)
    const db = load()
    const group = findGroup(db, groupId)
    const claim = input.claimMemberId
      ? group.members.find((item) => item.id === input.claimMemberId)
      : undefined
    if (input.claimMemberId && (!claim || claim.status !== 'pending')) {
      return fail(409, 'Этот участник уже подключил кошелёк')
    }
    const expiresAt = Date.now() + INVITE_TTL_MS
    const code = encodeInvite({
      g: group.id,
      m: claim?.id ?? null,
      n: claim?.name ?? null,
      e: Math.floor(expiresAt / 1000),
    })
    db.invites.push({
      code,
      groupId: group.id,
      claimMemberId: claim?.id ?? null,
      claimMemberName: claim?.name ?? null,
      expiresAt,
    })
    save(db)
    return {
      code,
      url: `${window.location.origin}/join/${code}`,
      expiresAt: new Date(expiresAt).toISOString(),
      claimMemberId: claim?.id ?? null,
    }
  },

  async getInvitePreview(code: string) {
    await delay(250)
    const db = load()
    const invite = findInvite(db, code)
    const group = findGroup(db, invite.groupId)
    return {
      code,
      groupId: group.id,
      groupName: group.name,
      invitedByName: 'Адиль',
      membersCount: group.members.length,
      claimMemberName: invite.claimMemberName,
      expiresAt: new Date(invite.expiresAt).toISOString(),
    }
  },

  /**
   * Пользователь в моке один и уже состоит в группе. Поэтому общая ссылка отвечает
   * alreadyMember, а персональная имитирует друга: его участник становится active.
   * В чужом браузере, где этого участника нет, он появляется сразу активным.
   */
  async acceptInvite(code: string) {
    await delay(350)
    const db = load()
    const invite = findInvite(db, code)
    const group = findGroup(db, invite.groupId)
    db.invites = db.invites.filter((item) => item.code !== code)
    if (invite.claimMemberId) {
      let claimed = group.members.find((item) => item.id === invite.claimMemberId)
      if (!claimed) {
        claimed = {
          ...member(invite.claimMemberId, invite.claimMemberName ?? 'Участник'),
          status: 'pending',
        }
        group.members.push(claimed)
      }
      claimed.status = 'active'
      // Друг подключил кошелёк по ссылке — в настоящем бэкенде здесь его адрес
      claimed.address ??= randomReference()
      save(db)
      return { groupId: group.id, memberId: claimed.id, alreadyMember: false }
    }
    save(db)
    return { groupId: group.id, memberId: ME, alreadyMember: true }
  },

  // ── Расчёты ──────────────────────────────────────────────────────────────

  /** Балансы демо-кошелька. Настоящий бэкенд читает их из сети. */
  async getWalletBalances(_address: string) {
    await delay(250)
    return { USDC: 84.2, USDT: 12 }
  },

  async prepareSettlement(
    groupId: string,
    input: {
      token: 'USDC' | 'USDT'
      payer: string
      transfers: Array<{ memberId: string; amount: number }>
    },
  ) {
    await delay(350)
    if (!stablecoinMint(input.token)) {
      return fail(400, `${input.token} нет в этой сети Solana — выбери другой стейблкоин`)
    }
    const group = findGroup(load(), groupId)
    const ledger = new Map(group.ledger)
    const transfers = input.transfers.map((transfer) => {
      const target = group.members.find((item) => item.id === transfer.memberId)
      const address = target ? addressOf(target) : null
      if (!target || !address) {
        return fail(409, `У ${target?.name ?? 'участника'} нет кошелька — перевести некуда`)
      }
      const owed = ledger.get(`${ME}>${target.id}`) ?? 0
      if (cents(transfer.amount) > owed) {
        return fail(409, `Ты должен ${target.name} меньше, чем хочешь перевести`)
      }
      return { memberId: target.id, name: target.name, address, amount: transfer.amount }
    })
    const total = transfers.reduce((sum, item) => sum + cents(item.amount), 0) / 100
    const memo = [
      `Divra: расчёт в группе «${group.name}»`,
      ...transfers.map(
        (item) => `${item.amount.toFixed(2)} ${input.token} → ${item.name} (${item.address})`,
      ),
      'Мок: в сеть не отправляется, переводы засчитываются после проверки подписи.',
    ].join('\n')
    const settlementId = randomReference()
    const expiresAt = Date.now() + SETTLEMENT_TTL_MS
    pendingSettlements.set(settlementId, {
      groupId: group.id,
      payer: input.payer,
      token: input.token,
      transfers,
      total,
      expiresAt,
    })
    return {
      settlementId,
      chain: 'solana' as const,
      token: input.token,
      transaction: await buildMemoTransaction(input.payer, memo),
      transfers,
      total,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  },

  /**
   * Настоящий бэкенд отправляет транзакцию в сеть, ждёт подтверждения и сверяет переводы
   * в блокчейне. Мок проверяет подпись и сразу засчитывает переводы.
   */
  async submitSettlement(
    groupId: string,
    input: { settlementId: string; signedTransaction: string },
  ) {
    await delay(700)
    const pending = pendingSettlements.get(input.settlementId)
    if (!pending || pending.groupId !== groupId) {
      return fail(404, 'Перевод не найден — собери его заново')
    }
    pendingSettlements.delete(input.settlementId)
    if (pending.expiresAt < Date.now()) {
      return fail(410, 'Транзакция устарела — собери перевод заново')
    }
    const verified = await verifySignedTransaction(input.signedTransaction, pending.payer)
    if (!verified) {
      return fail(401, 'Подпись не прошла проверку')
    }
    const db = load()
    const group = findGroup(db, groupId)
    const now = new Date().toISOString()
    for (const transfer of pending.transfers) {
      // Получатель «должен» тебе столько же — встречный долг гасит твой
      addDebt(group, transfer.memberId, ME, cents(transfer.amount))
      group.payments.push({
        id: `p${Date.now()}${transfer.memberId}`,
        fromId: ME,
        toId: transfer.memberId,
        amount: transfer.amount,
        createdAt: now,
      })
    }
    save(db)
    return {
      settlementId: input.settlementId,
      signature: verified.signature,
      status: 'confirmed' as const,
      token: pending.token,
      transfers: pending.transfers,
      total: pending.total,
    }
  },

  async createPaymentRequests(
    groupId: string,
    input: {
      token: 'USDC' | 'USDT'
      recipient: string
      memberIds: string[]
      message: string
      remindInDays: number | null
    },
  ) {
    await delay(350)
    const mint = stablecoinMint(input.token)
    if (!mint) {
      return fail(400, `${input.token} нет в этой сети Solana — выбери другой стейблкоин`)
    }
    const db = load()
    const group = findGroup(db, groupId)
    const ledger = new Map(group.ledger)
    const expires = Math.floor((Date.now() + REQUEST_TTL_MS) / 1000)
    const created = input.memberIds.map((memberId) => {
      const debtor = group.members.find((item) => item.id === memberId)
      const owed = ledger.get(`${memberId}>${ME}`) ?? 0
      if (!debtor || owed <= 0) {
        return fail(409, `${debtor?.name ?? 'Участник'} тебе ничего не должен`)
      }
      const payload: RequestPayload = {
        g: group.id,
        gn: group.name,
        f: MY_NAME,
        a: input.recipient,
        t: debtor.name,
        s: owed / 100,
        k: input.token,
        m: input.message.trim(),
        r: randomReference(),
        e: expires,
      }
      const code = packCode(payload)
      return {
        code,
        memberId,
        memberName: debtor.name,
        amount: owed / 100,
        token: input.token,
        url: `${window.location.origin}/r/${code}`,
        solanaPayUrl: solanaPayUrl(payload, mint),
      }
    })
    const now = new Date().toISOString()
    db.requests = [
      ...(db.requests ?? []).filter(
        (item) => !(item.groupId === group.id && input.memberIds.includes(item.memberId)),
      ),
      ...created.map((item) => ({
        code: item.code,
        groupId: group.id,
        memberId: item.memberId,
        createdAt: now,
      })),
    ]
    save(db)
    return created
  },

  /** Мои запросы в группе. Мок оплату в сети не ищет: запрос либо ждёт, либо истёк */
  async getSentRequests(groupId: string) {
    await delay(150)
    const now = Date.now()
    return (load().requests ?? [])
      .filter((item) => item.groupId === groupId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((item) => {
        const payload = unpackCode(item.code) as RequestPayload | null
        const mint = payload ? stablecoinMint(payload.k) : null
        if (!payload || !mint) {
          return []
        }
        return [
          {
            code: item.code,
            memberId: item.memberId,
            memberName: payload.t,
            amount: payload.s,
            token: payload.k,
            url: `${window.location.origin}/r/${item.code}`,
            solanaPayUrl: solanaPayUrl(payload, mint),
            status: payload.e * 1000 < now ? ('expired' as const) : ('open' as const),
            createdAt: item.createdAt,
            expiresAt: new Date(payload.e * 1000).toISOString(),
            paidAt: null,
          },
        ]
      })
  },

  async getPaymentRequest(code: string) {
    await delay(250)
    const raw = unpackCode(code)
    const payload = raw as RequestPayload | null
    if (!payload || typeof payload.a !== 'string' || typeof payload.s !== 'number') {
      return fail(404, 'Запрос не найден')
    }
    if (payload.e * 1000 < Date.now()) {
      return fail(410, 'Срок запроса истёк')
    }
    const mint = stablecoinMint(payload.k)
    if (!mint) {
      return fail(400, `${payload.k} нет в этой сети Solana`)
    }
    return {
      code,
      fromName: payload.f,
      fromAddress: payload.a,
      toName: payload.t,
      groupName: payload.gn,
      amount: payload.s,
      token: payload.k,
      message: payload.m,
      solanaPayUrl: solanaPayUrl(payload, mint),
      expiresAt: new Date(payload.e * 1000).toISOString(),
    }
  },
}

/** Сбросить мок-данные: демо-база вернётся к начальной, пустая — снова станет пустой. */
export const resetMockGroups = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(EMPTY_STORAGE_KEY)
  } catch {
    // Нет доступа к storage — сбрасывать нечего
  }
}
