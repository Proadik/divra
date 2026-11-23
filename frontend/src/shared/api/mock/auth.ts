/**
 * Имитация бэкенда подтверждения кошелька. Делает то же, что будет делать сервер:
 * собирает memo-транзакцию с одноразовым nonce, а потом проверяет подпись ed25519.
 * Удаляется, когда появится настоящий API (VITE_API_MOCK=false).
 */
import { MEMO_PROGRAM_ADDRESS, getAddMemoInstruction } from '@solana-program/memo'
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getUtf8Decoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  verifySignature,
} from '@solana/kit'
import { env } from '@/shared/config'
import { ApiError } from '../client'

type Challenge = {
  address: string
  nonce: string
  message: string
  expiresAt: number
}

const TTL_MS = 5 * 60 * 1000
const SESSION_KEY = 'divra.mock-auth-session'
/** Имя профиля в моке */
const PROFILE_NAME_KEY = 'divra.mock-profile-name'
const DETECT_KEY = 'divra.mock-detect-transfers'
const MOCK_USER_ID = '00000000-0000-4000-8000-000000000001'

const mockToken = (): string =>
  `mock.${getBase64Decoder().decode(crypto.getRandomValues(new Uint8Array(24)))}`

const rememberSession = (walletAddress: string): void => {
  try {
    localStorage.setItem(SESSION_KEY, walletAddress)
  } catch {
    // Нет доступа к storage — сессия проживёт только до перезагрузки
  }
}

const sessionAddress = (): string | null => {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}
const challenges = new Map<string, Challenge>()

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')

const reject = (status: number, message: string): never => {
  throw new ApiError(status, { message }, message)
}

const buildMessage = (walletAddress: string, nonce: string, issuedAt: string): string =>
  [
    'Divra: подтверждение владения кошельком',
    `Адрес: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Выдано: ${issuedAt}`,
    'Транзакция не отправляется в сеть и ничего не списывает.',
  ].join('\n')

/** Достаём текст memo из подписанной транзакции, чтобы сверить nonce. */
const readMemo = (messageBytes: Uint8Array): string | null => {
  const message = getCompiledTransactionMessageDecoder().decode(messageBytes)
  if (!('instructions' in message)) {
    return null
  }
  const memoIndex = message.staticAccounts.indexOf(MEMO_PROGRAM_ADDRESS)
  const memo = message.instructions.find((ix) => ix.programAddressIndex === memoIndex)
  return memo?.data ? getUtf8Decoder().decode(memo.data) : null
}

export const mockAuthBackend = {
  async createChallenge(input: { chain: string; address: string }) {
    await delay(400)
    if (input.chain !== 'solana') {
      return reject(400, `Сеть ${input.chain} пока не поддерживается`)
    }
    const feePayer = address(input.address)
    const challengeId = randomHex(16)
    const nonce = randomHex(8)
    const issuedAt = new Date().toISOString()
    const message = buildMessage(input.address, nonce, issuedAt)

    const rpc = createSolanaRpc(env.SOLANA_RPC_URL)
    const { value: blockhash } = await rpc.getLatestBlockhash().send()

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(feePayer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
      (tx) => appendTransactionMessageInstruction(getAddMemoInstruction({ memo: message }), tx),
    )

    const expiresAt = Date.now() + TTL_MS
    challenges.set(challengeId, { address: input.address, nonce, message, expiresAt })

    return {
      chain: 'solana',
      challengeId,
      transaction: getBase64EncodedWireTransaction(compileTransaction(transactionMessage)),
      message,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  },

  async verify(input: { challengeId: string; address: string; signedPayload: string }) {
    await delay(500)
    const challenge = challenges.get(input.challengeId)
    if (!challenge) {
      return reject(404, 'Запрос подтверждения не найден')
    }
    challenges.delete(input.challengeId)
    if (challenge.expiresAt < Date.now()) {
      return reject(410, 'Срок запроса истёк')
    }
    if (challenge.address !== input.address) {
      return reject(403, 'Адрес не совпадает с запросом')
    }

    const bytes = new Uint8Array(getBase64Encoder().encode(input.signedPayload))
    const transaction = getTransactionDecoder().decode(bytes)
    const signer = address(challenge.address)
    const signature = transaction.signatures[signer]
    if (!signature) {
      return reject(401, 'Транзакция не подписана этим адресом')
    }
    const messageBytes = new Uint8Array(transaction.messageBytes)
    const publicKey = await getPublicKeyFromAddress(signer)
    const valid = await verifySignature(publicKey, signature, messageBytes)
    if (!valid) {
      return reject(401, 'Подпись не прошла проверку')
    }
    const memo = readMemo(messageBytes)
    if (!memo?.includes(`Nonce: ${challenge.nonce}`)) {
      return reject(401, 'Транзакция не содержит выданный nonce')
    }

    // Вместо HttpOnly-cookie мок помнит «сессию» в localStorage — только для демо
    rememberSession(challenge.address)
    return {
      tokenType: 'Bearer',
      accessToken: mockToken(),
      expiresIn: 900,
      user: { id: MOCK_USER_ID, chain: 'solana', address: challenge.address, created: false },
    }
  },

  async refresh() {
    await delay(150)
    if (!sessionAddress()) {
      return reject(401, 'Сессии нет — войди заново')
    }
    return { tokenType: 'Bearer', accessToken: mockToken(), expiresIn: 900 }
  },

  signOut() {
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch {
      // Нет доступа к storage — сессии и так нет
    }
  },

  async updateProfile(input: { displayName?: string; detectTransfers?: boolean }) {
    await delay(250)
    try {
      if (input.displayName !== undefined) {
        localStorage.setItem(PROFILE_NAME_KEY, input.displayName.trim())
      }
      if (input.detectTransfers !== undefined) {
        localStorage.setItem(DETECT_KEY, String(input.detectTransfers))
      }
    } catch {
      // Нет доступа к storage — настройки не сохранятся
    }
    return this.me()
  },

  /** Удаление аккаунта в моке: сессия и имя профиля стираются, группы — тоже (их видел только ты) */
  deleteAccount() {
    this.signOut()
    try {
      localStorage.removeItem(PROFILE_NAME_KEY)
      localStorage.removeItem('divra.mock-db')
      localStorage.removeItem('divra.mock-db:empty')
    } catch {
      // Нет доступа к storage — удалять нечего
    }
  },

  async me() {
    await delay(200)
    const walletAddress = sessionAddress()
    if (!walletAddress) {
      return reject(401, 'Сессии нет — войди заново')
    }
    const createdAt = new Date(Date.now() - 3 * 24 * 3_600_000).toISOString()
    let displayName: string | null = null
    let detectTransfers = true
    try {
      displayName = localStorage.getItem(PROFILE_NAME_KEY)
      detectTransfers = localStorage.getItem(DETECT_KEY) !== 'false'
    } catch {
      // Нет доступа к storage — настройки по умолчанию
    }
    return {
      id: MOCK_USER_ID,
      displayName,
      detectTransfers,
      createdAt,
      lastSignInAt: new Date().toISOString(),
      wallets: [{ chain: 'solana', address: walletAddress, createdAt }],
    }
  },
}
