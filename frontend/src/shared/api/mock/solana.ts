/**
 * Общие для моков операции с транзакциями Solana: собрать memo-транзакцию и проверить подпись.
 * Настоящий бэкенд делает то же самое на сервере.
 */
import { MEMO_PROGRAM_ADDRESS, getAddMemoInstruction } from '@solana-program/memo'
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
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

/** Транзакция с одной memo-инструкцией, плательщик комиссии — payer. Base64 wire format. */
export const buildMemoTransaction = async (payer: string, memo: string): Promise<string> => {
  const rpc = createSolanaRpc(env.SOLANA_RPC_URL)
  const { value: blockhash } = await rpc.getLatestBlockhash().send()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(address(payer), tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
    (tx) => appendTransactionMessageInstruction(getAddMemoInstruction({ memo }), tx),
  )
  return getBase64EncodedWireTransaction(compileTransaction(message))
}

export type VerifiedTransaction = {
  /** Подпись в base58 — так её показывают обозреватели */
  signature: string
  memo: string | null
}

/** Проверить, что транзакция подписана этим адресом. null — подписи нет или она неверна. */
export const verifySignedTransaction = async (
  signedBase64: string,
  signerAddress: string,
): Promise<VerifiedTransaction | null> => {
  const bytes = new Uint8Array(getBase64Encoder().encode(signedBase64))
  const transaction = getTransactionDecoder().decode(bytes)
  const signer = address(signerAddress)
  const signature = transaction.signatures[signer]
  if (!signature) {
    return null
  }
  const messageBytes = new Uint8Array(transaction.messageBytes)
  const valid = await verifySignature(
    await getPublicKeyFromAddress(signer),
    signature,
    messageBytes,
  )
  if (!valid) {
    return null
  }
  const message = getCompiledTransactionMessageDecoder().decode(messageBytes)
  let memo: string | null = null
  if ('instructions' in message) {
    const memoIndex = message.staticAccounts.indexOf(MEMO_PROGRAM_ADDRESS)
    const instruction = message.instructions.find((ix) => ix.programAddressIndex === memoIndex)
    memo = instruction?.data ? getUtf8Decoder().decode(instruction.data) : null
  }
  return { signature: getBase58Decoder().decode(signature), memo }
}

/** Случайный публичный ключ в base58 — для reference в Solana Pay */
export const randomReference = (): string =>
  getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(32)))
