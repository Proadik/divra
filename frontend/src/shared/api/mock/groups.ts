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
import { mockEvents } from './events'
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
  /** Доли в центах: [memberId, cents]. У демо-расходов нет — достраиваем (sharesOf) */
  shares?: Array<[string, number]>
  splitMode?: 'equal' | 'exact' | 'percent' | 'shares'
  /** Записал ты — можно править, даже если платил другой */
  createdByMe?: boolean
  updatedAt?: string | null
}

type StoredPayment = {
  id: string
  fromId: string
  toId: string
  amount: number
  createdAt: string
  /** cash — получатель отметил возврат наличными; по умолчанию перевод в сети */
  method?: 'onchain' | 'cash'
}

type StoredMember = {
  id: string
  name: string
  initials: string
  isMe: boolean
  status: 'pending' | 'active'
  /** Адрес кошелька; у старых записей поля нет — берём из DEMO_ADDRESSES */
  address?: string | null
  /** Вышел или удалён: в списках не показываем, старые расходы ссылаются */
  left?: boolean
}

type StoredRequest = {
  code: string
  groupId: string
  memberId: string
  createdAt: string
  /** Сумма в центах — чтобы закрыть запрос наличными */
  amountCents?: number
  paidAt?: string | null
  cancelledAt?: string | null
  remindedAt?: string | null
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
  createdAt?: string
  revoked?: boolean
}

type MockDb = {
  version: 3
  groups: StoredGroup[]
  invites: StoredInvite[]
  /** Запросы на оплату — чтобы показать «запрос вчера» */
  requests?: StoredRequest[]
  /** Переводы мимо Divra, замеченные «в сети» (в моке — по кнопке имитации) */
  detected?: StoredDetected[]
}

type StoredDetected = {
  id: string
  signature: string
  /** id участника — в демо-группах у одного человека одинаковый id */
  fromMemberId: string
  fromName: string
  amount: number
  createdAt: string
  status: 'pending' | 'applied' | 'dismissed'
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
const REMIND_INTERVAL_MS = 24 * 3_600_000
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
  if (invite.revoked) {
    return fail(410, 'Приглашение отозвано')
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

const activeMembers = (group: StoredGroup): StoredMember[] =>
  group.members.filter((item) => !item.left)

const canEditOf = (expense: StoredExpense): boolean =>
  expense.createdByMe === true || expense.paidById === ME

type ExpenseView = Omit<
  StoredExpense,
  'shares' | 'splitMode' | 'createdByMe' | 'updatedAt' | 'original'
> & { original: StoredExpense['original']; canEdit: boolean }

const expenseView = (expense: StoredExpense): ExpenseView => ({
  id: expense.id,
  title: expense.title,
  category: expense.category,
  paidById: expense.paidById,
  amount: expense.amount,
  myShare: expense.myShare,
  original: expense.original ?? null,
  createdAt: expense.createdAt,
  canEdit: canEditOf(expense),
})

/**
 * Доли расхода в центах. У демо-расходов их нет: твоя доля известна, остаток делим поровну
 * между остальными участниками.
 */
const sharesOf = (group: StoredGroup, expense: StoredExpense): Array<[string, number]> => {
  if (expense.shares) {
    return expense.shares
  }
  const mine = cents(expense.myShare)
  const others = activeMembers(group).filter((item) => item.id !== ME)
  const rest = cents(expense.amount) - mine
  const base = others.length > 0 ? Math.floor(rest / others.length) : 0
  let extra = rest - base * others.length
  const shares: Array<[string, number]> = others.map((item) => {
    const value = base + (extra > 0 ? 1 : 0)
    extra -= 1
    return [item.id, value]
  })
  return mine > 0 ? [[ME, mine], ...shares] : shares
}

/** Доли расхода в журнале: sign = 1 — добавить долги, -1 — убрать (правка, удаление) */
const applyShares = (
  group: StoredGroup,
  paidById: string,
  shares: Array<[string, number]>,
  sign: 1 | -1,
): void => {
  for (const [memberId, value] of shares) {
    if (memberId !== paidById && value > 0) {
      if (sign === 1) {
        addDebt(group, memberId, paidById, value)
      } else {
        addDebt(group, paidById, memberId, value)
      }
    }
  }
}

const hasDebts = (group: StoredGroup, memberId: string): boolean =>
  group.ledger.some(([key, value]) => value > 0 && key.split('>').includes(memberId))

const findExpense = (group: StoredGroup, expenseId: string): StoredExpense =>
  group.expenses.find((item) => item.id === expenseId) ?? fail(404, 'Расход не найден')

type ExpenseInput = {
  title: string
  category: Category
  paidById: string
  amount: number
  splitMode?: StoredExpense['splitMode']
  original?: StoredExpense['original']
  shares: Array<{ memberId: string; amount: number }>
}

const checkMembers = (group: StoredGroup, input: ExpenseInput): void => {
  const ids = new Set(activeMembers(group).map((item) => item.id))
  if (
    ![input.paidById, ...input.shares.map((share) => share.memberId)].every((id) => ids.has(id))
  ) {
    fail(422, 'Участник не из этой группы или вышел из неё')
  }
}

const findRequest = (db: MockDb, groupId: string, code: string): StoredRequest =>
  (db.requests ?? []).find(
    (item) => item.groupId === groupId && item.code === code && !item.cancelledAt,
  ) ?? fail(404, 'Запрос не найден')

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
  type: 'expense' | 'payment' | 'cash'
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
  membersCount: activeMembers(group).length,
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
    type: payment.method === 'cash' ? 'cash' : 'payment',
    groupId: group.id,
    groupName: group.name,
    actor: personOf(group, payment.fromId),
    counterpart: personOf(group, payment.toId),
    title: null,
    myDelta: payment.toId === ME ? payment.amount : payment.fromId === ME ? -payment.amount : 0,
    createdAt: payment.createdAt,
  })),
]

// ── История: демо-переводы ──────────────────────────────────────────────────

const randomPad = '5ZcNTmJLsgCxw1pJ'.repeat(6)

/**
 * Старые переводы демо-кошелька: от незнакомых адресов и друзьям. Время — от «сейчас»,
 * поэтому список стабилен в пределах сессии и его можно листать (бесконечная прокрутка).
 */
type MockHistoryItem = {
  id: string
  signature: string
  token: 'USDC' | 'USDT'
  amount: number
  direction: 'in' | 'out'
  counterparty: { name: string | null; address: string | null }
  countedIn: string | null
  suggested: boolean
  createdAt: string
}

const demoChainHistory = (): MockHistoryItem[] => {
  const strangers = [
    '3Ftc9QkU8bNt7S2hWx6gK1yPq4LmZr5VdE8aJc2BnH7s',
    '7mKdV2pXq9Lw4Rt6Yh1Nb8Zc3Sf5Gj2Ua9Ee4Wk6Qx1M',
    '9eHs4Tn2Bv7Lq1Xc6Zp3Wm8Ka5Rd2Uj9Fy4Gt6Nb1Vc3',
  ]
  return Array.from({ length: 36 }, (_, index) => {
    const incoming = index % 3 !== 1
    const friend = index % 4 === 0 ? (index % 8 === 0 ? 'Дана' : 'Тимур') : null
    return {
      id: `demo-${String(index).padStart(2, '0')}`,
      signature: (`demo${index}` + randomPad.repeat(2)).slice(0, 88),
      token: index % 5 === 0 ? ('USDT' as const) : ('USDC' as const),
      amount: Math.round((5 + ((index * 37) % 140) + (index % 4) * 0.25) * 100) / 100,
      direction: incoming ? ('in' as const) : ('out' as const),
      counterparty: {
        name: friend,
        address: friend ? null : (strangers[index % strangers.length] ?? null),
      },
      countedIn: null,
      suggested: false,
      createdAt: hoursAgo(72 + index * 11),
    }
  })
}

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
      members: activeMembers(group).map(publicMember),
      myBalance: balanceCents(group) / 100,
      debts: myDebts(group),
      transfersBeforeSimplify: group.transfersBeforeSimplify,
      expenses: [...group.expenses]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(expenseView),
    }
  },

  async createExpense(groupId: string, input: ExpenseInput) {
    await delay(400)
    const db = load()
    const group = findGroup(db, groupId)
    checkMembers(group, input)
    const shares = input.shares.map((share): [string, number] => [
      share.memberId,
      cents(share.amount),
    ])
    applyShares(group, input.paidById, shares, 1)
    group.transfersBeforeSimplify += shares.filter(
      ([memberId, value]) => memberId !== input.paidById && value > 0,
    ).length
    const expense: StoredExpense = {
      id: `e${Date.now()}`,
      title: input.title.trim(),
      category: input.category,
      paidById: input.paidById,
      amount: input.amount,
      myShare: input.shares.find((share) => share.memberId === ME)?.amount ?? 0,
      original: input.original ?? null,
      createdAt: new Date().toISOString(),
      shares,
      splitMode: input.splitMode ?? 'equal',
      createdByMe: true,
      updatedAt: null,
    }
    group.expenses.push(expense)
    save(db)
    return expenseView(expense)
  },

  async getExpense(groupId: string, expenseId: string) {
    await delay(200)
    const group = findGroup(load(), groupId)
    const expense = findExpense(group, expenseId)
    return {
      ...expenseView(expense),
      splitMode: expense.splitMode ?? 'equal',
      shares: sharesOf(group, expense).map(([memberId, value]) => ({
        memberId,
        amount: value / 100,
      })),
      updatedAt: expense.updatedAt ?? null,
    }
  },

  async updateExpense(groupId: string, expenseId: string, input: ExpenseInput) {
    await delay(400)
    const db = load()
    const group = findGroup(db, groupId)
    const expense = findExpense(group, expenseId)
    if (!canEditOf(expense)) {
      return fail(403, 'Править расход может только автор или плательщик')
    }
    checkMembers(group, input)
    applyShares(group, expense.paidById, sharesOf(group, expense), -1)
    const shares = input.shares.map((share): [string, number] => [
      share.memberId,
      cents(share.amount),
    ])
    applyShares(group, input.paidById, shares, 1)
    Object.assign(expense, {
      title: input.title.trim(),
      category: input.category,
      paidById: input.paidById,
      amount: input.amount,
      myShare: input.shares.find((share) => share.memberId === ME)?.amount ?? 0,
      original: input.original ?? null,
      shares,
      splitMode: input.splitMode ?? 'equal',
      updatedAt: new Date().toISOString(),
    })
    save(db)
    return expenseView(expense)
  },

  async deleteExpense(groupId: string, expenseId: string) {
    await delay(300)
    const db = load()
    const group = findGroup(db, groupId)
    const expense = findExpense(group, expenseId)
    if (!canEditOf(expense)) {
      return fail(403, 'Удалить расход может только автор или плательщик')
    }
    applyShares(group, expense.paidById, sharesOf(group, expense), -1)
    group.expenses = group.expenses.filter((item) => item.id !== expenseId)
    save(db)
  },

  /** Свой id — выйти из группы; чужой — удалить участника без кошелька. Только без долгов */
  async removeMember(groupId: string, memberId: string) {
    await delay(300)
    const db = load()
    const group = findGroup(db, groupId)
    const target =
      activeMembers(group).find((item) => item.id === memberId) ?? fail(404, 'Участник не найден')
    const leaving = target.id === ME
    if (!leaving && target.status === 'active') {
      return fail(403, 'Участника с кошельком удалить нельзя — он может выйти только сам')
    }
    if (hasDebts(group, target.id)) {
      return fail(409, 'Сначала рассчитайтесь: у участника есть долги или ему должны')
    }
    const now = new Date().toISOString()
    if (leaving) {
      // Ты вышел — группа пропадает из твоего списка
      db.groups = db.groups.filter((item) => item.id !== group.id)
      db.requests = (db.requests ?? []).filter((item) => item.groupId !== group.id)
    } else {
      target.left = true
      for (const invite of db.invites) {
        if (invite.groupId === group.id && invite.claimMemberId === target.id) {
          invite.revoked = true
        }
      }
      for (const item of db.requests ?? []) {
        if (item.groupId === group.id && item.memberId === target.id && !item.paidAt) {
          item.cancelledAt ??= now
        }
      }
    }
    save(db)
    return { left: leaving }
  },

  async addMember(groupId: string, input: { displayName: string }) {
    await delay(300)
    const db = load()
    const group = findGroup(db, groupId)
    const name = input.displayName.trim()
    if (activeMembers(group).some((item) => item.name.toLowerCase() === name.toLowerCase())) {
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
      createdAt: new Date().toISOString(),
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
      membersCount: activeMembers(group).length,
      claimMemberName: invite.claimMemberName,
      expiresAt: new Date(invite.expiresAt).toISOString(),
    }
  },

  async getActiveInvites(groupId: string) {
    await delay(200)
    const db = load()
    const group = findGroup(db, groupId)
    const now = Date.now()
    return db.invites
      .filter((item) => item.groupId === group.id && !item.revoked && item.expiresAt > now)
      .map((item) => ({
        code: item.code,
        url: `${window.location.origin}/join/${item.code}`,
        expiresAt: new Date(item.expiresAt).toISOString(),
        claimMemberId: item.claimMemberId,
        invitedByName: MY_NAME,
        claimMemberName: item.claimMemberName,
        uses: 0,
        createdAt: item.createdAt ?? new Date(item.expiresAt - INVITE_TTL_MS).toISOString(),
      }))
  },

  async revokeInvite(groupId: string, code: string) {
    await delay(200)
    const db = load()
    const group = findGroup(db, groupId)
    const invite = db.invites.find(
      (item) => item.groupId === group.id && item.code === code && !item.revoked,
    )
    if (!invite) {
      return fail(404, 'Приглашение не найдено')
    }
    invite.revoked = true
    save(db)
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
        (item) =>
          !(item.groupId === group.id && input.memberIds.includes(item.memberId) && !item.paidAt),
      ),
      ...created.map((item) => ({
        code: item.code,
        groupId: group.id,
        memberId: item.memberId,
        createdAt: now,
        amountCents: cents(item.amount),
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
      .filter((item) => item.groupId === groupId && !item.cancelledAt)
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
            status: item.paidAt
              ? ('paid' as const)
              : payload.e * 1000 < now
                ? ('expired' as const)
                : ('open' as const),
            createdAt: item.createdAt,
            expiresAt: new Date(payload.e * 1000).toISOString(),
            paidAt: item.paidAt ?? null,
            signature: null,
            remindedAt: item.remindedAt ?? null,
          },
        ]
      })
  },

  async cancelPaymentRequest(groupId: string, code: string) {
    await delay(200)
    const db = load()
    const request = findRequest(db, groupId, code)
    if (request.paidAt) {
      return fail(409, 'Запрос уже оплачен')
    }
    request.cancelledAt = new Date().toISOString()
    save(db)
  },

  async remindPaymentRequest(groupId: string, code: string) {
    await delay(200)
    const db = load()
    const request = findRequest(db, groupId, code)
    const payload = unpackCode(code) as RequestPayload | null
    if (!payload || request.paidAt || payload.e * 1000 < Date.now()) {
      return fail(409, 'Запрос уже оплачен, отменён или истёк — напоминать не о чем')
    }
    const now = Date.now()
    if (request.remindedAt && now - Date.parse(request.remindedAt) < REMIND_INTERVAL_MS) {
      return fail(429, 'Уже напоминал за последние сутки — следующее напоминание завтра')
    }
    request.remindedAt = new Date(now).toISOString()
    save(db)
    const url = `${window.location.origin}/r/${code}`
    const amount = payload.s.toFixed(2).replace(/\.00$/, '')
    return {
      code,
      url,
      text: `${payload.t}, напоминаю про долг в «${payload.gn}»: ${amount} ${payload.k}. Оплатить можно по ссылке: ${url}`,
      remindedAt: request.remindedAt,
      nextReminderAt: new Date(now + REMIND_INTERVAL_MS).toISOString(),
    }
  },

  /** Получатель отмечает возврат наличными: долг memberId → ты уменьшается */
  async recordCashPayment(groupId: string, input: { memberId: string; amount: number }) {
    await delay(300)
    const db = load()
    const group = findGroup(db, groupId)
    const debtor = activeMembers(group).find((item) => item.id === input.memberId && item.id !== ME)
    if (!debtor) {
      return fail(422, 'Участник не из этой группы')
    }
    const owed = new Map(group.ledger).get(`${debtor.id}>${ME}`) ?? 0
    if (owed <= 0) {
      return fail(409, 'Этот участник тебе ничего не должен')
    }
    const amount = cents(input.amount)
    if (amount > owed) {
      return fail(422, `Больше долга: должен ${(owed / 100).toFixed(2)}`)
    }
    addDebt(group, ME, debtor.id, amount)
    const now = new Date().toISOString()
    group.payments.push({
      id: `c${Date.now()}`,
      fromId: debtor.id,
      toId: ME,
      amount: amount / 100,
      createdAt: now,
      method: 'cash',
    })
    for (const item of db.requests ?? []) {
      if (
        item.groupId === group.id &&
        item.memberId === debtor.id &&
        !item.paidAt &&
        !item.cancelledAt
      ) {
        if (amount >= (item.amountCents ?? Number.POSITIVE_INFINITY)) {
          item.paidAt = now
        } else {
          item.cancelledAt = now
        }
      }
    }
    save(db)
    return { memberId: debtor.id, amount: amount / 100, remaining: (owed - amount) / 100 }
  },

  // ── История переводов в сети ─────────────────────────────────────────────

  /**
   * «История»: переводы в сети — по запросам и расчётам, переводы мимо Divra и (в демо) старые
   * переводы с чужих кошельков, чтобы было что листать. Курсор мока — просто смещение.
   */
  async getHistory(cursor: string | undefined, limit: number) {
    await delay(250)
    const db = load()
    const signatureOf = (id: string): string => `${id}${randomPad}${randomPad}`.slice(0, 88)
    const items = [
      ...db.groups.flatMap((group) =>
        group.payments
          .filter(
            (payment) =>
              payment.method !== 'cash' && (payment.fromId === ME || payment.toId === ME),
          )
          .map((payment) => {
            const other = personOf(group, payment.toId === ME ? payment.fromId : payment.toId)
            return {
              id: `${group.id}:${payment.id}`,
              signature: signatureOf(payment.id),
              token: 'USDC' as const,
              amount: payment.amount,
              direction: payment.toId === ME ? ('in' as const) : ('out' as const),
              counterparty: { name: other.name, address: null },
              countedIn: group.name,
              suggested: false,
              createdAt: payment.createdAt,
            }
          }),
      ),
      ...(db.detected ?? [])
        .filter((item) => item.status !== 'applied')
        .map((item) => ({
          id: item.id,
          signature: item.signature,
          token: 'USDC' as const,
          amount: item.amount,
          direction: 'in' as const,
          counterparty: { name: item.fromName, address: null },
          countedIn: null,
          suggested: item.status === 'pending',
          createdAt: item.createdAt,
        })),
      ...(withDemo() ? demoChainHistory() : []),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    const offset = Math.max(0, Number(cursor ?? 0) || 0)
    const page = items.slice(offset, offset + limit)
    return {
      items: page,
      nextCursor: offset + limit < items.length ? String(offset + limit) : null,
    }
  },

  // ── Переводы мимо Divra ──────────────────────────────────────────────────

  /** Подсказки: где отправитель сейчас должен тебе — туда можно засчитать */
  async getDetectedTransfers() {
    await delay(200)
    const db = load()
    return (db.detected ?? [])
      .filter((item) => item.status === 'pending')
      .flatMap((item) => {
        const groups = db.groups
          .map((group) => ({
            groupId: group.id,
            groupName: group.name,
            owed: (new Map(group.ledger).get(`${item.fromMemberId}>${ME}`) ?? 0) / 100,
          }))
          .filter((group) => group.owed > 0)
          .sort((a, b) => b.owed - a.owed)
        if (groups.length === 0) {
          return []
        }
        return [
          {
            id: item.id,
            signature: item.signature,
            token: 'USDC' as const,
            amount: item.amount,
            fromName: item.fromName,
            createdAt: item.createdAt,
            groups,
          },
        ]
      })
  },

  async applyDetectedTransfer(id: string, groupId: string) {
    await delay(350)
    const db = load()
    const item = (db.detected ?? []).find(
      (detected) => detected.id === id && detected.status === 'pending',
    )
    if (!item) {
      return fail(404, 'Перевод не найден')
    }
    const group = findGroup(db, groupId)
    const owed = new Map(group.ledger).get(`${item.fromMemberId}>${ME}`) ?? 0
    if (owed <= 0) {
      return fail(409, 'В этой группе он тебе больше ничего не должен')
    }
    const amount = Math.min(cents(item.amount), owed)
    addDebt(group, ME, item.fromMemberId, amount)
    group.payments.push({
      id: `t${Date.now()}`,
      fromId: item.fromMemberId,
      toId: ME,
      amount: amount / 100,
      createdAt: new Date().toISOString(),
    })
    item.status = 'applied'
    save(db)
    mockEvents.emit({ type: 'group.changed', groupId: group.id })
    return { groupId: group.id, amount: amount / 100, remaining: (owed - amount) / 100 }
  },

  async dismissDetectedTransfer(id: string) {
    await delay(200)
    const db = load()
    const item = (db.detected ?? []).find(
      (detected) => detected.id === id && detected.status === 'pending',
    )
    if (!item) {
      return fail(404, 'Перевод не найден')
    }
    item.status = 'dismissed'
    save(db)
  },

  /**
   * Имитация: должник перевёл тебе из кошелька, мимо Divra. Настоящий бэкенд замечает такие
   * переводы в потоке LaserStream; мок берёт первого, кто тебе должен, и половину долга.
   */
  async simulateDetectedTransfer() {
    await delay(150)
    const db = load()
    const debt = db.groups
      .flatMap((group) =>
        group.ledger.flatMap(([key, value]) => {
          const [fromId = '', toId = ''] = key.split('>')
          const from = activeMembers(group).find((item) => item.id === fromId)
          return toId === ME && value > 0 && from ? [{ from, value }] : []
        }),
      )
      .at(0)
    if (!debt) {
      return fail(409, 'Тебе никто не должен — переводить некому')
    }
    const detected: StoredDetected = {
      id: `d${Date.now()}`,
      signature: randomReference() + randomReference(),
      fromMemberId: debt.from.id,
      fromName: debt.from.name,
      amount: Math.max(1, Math.round(debt.value / 200)),
      createdAt: new Date().toISOString(),
      status: 'pending',
    }
    db.detected = [...(db.detected ?? []), detected]
    save(db)
    mockEvents.emit({ type: 'transfer.detected', id: detected.id })
  },

  async getPaymentRequest(code: string) {
    await delay(250)
    const raw = unpackCode(code)
    const payload = raw as RequestPayload | null
    if (!payload || typeof payload.a !== 'string' || typeof payload.s !== 'number') {
      return fail(404, 'Запрос не найден')
    }
    // Код самодостаточный, но отмену и оплату наличными видно только в своей базе
    const stored = (load().requests ?? []).find((item) => item.code === code)
    if (stored?.cancelledAt && !stored.paidAt) {
      return fail(410, 'Запрос отменён')
    }
    if (!stored?.paidAt && payload.e * 1000 < Date.now()) {
      return fail(410, 'Срок запроса истёк')
    }
    const mint = stablecoinMint(payload.k)
    if (!mint) {
      return fail(400, `${payload.k} нет в этой сети Solana`)
    }
    return {
      status: stored?.paidAt ? ('paid' as const) : ('open' as const),
      paidAt: stored?.paidAt ?? null,
      signature: null,
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
