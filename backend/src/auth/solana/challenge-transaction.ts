import { createHash, randomBytes } from 'node:crypto';
import {
  MEMO_PROGRAM_ADDRESS,
  getAddMemoInstruction,
} from '@solana-program/memo';
import {
  type Address,
  type Blockhash,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getUtf8Decoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  verifySignature,
} from '@solana/kit';

/** Больше пакета Solana транзакция не бывает: всё длиннее — мусор, не разбираем */
const MAX_TRANSACTION_BYTES = 1232;
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export interface ChallengeTransaction {
  /** Неподписанная транзакция, base64 (wire format) — её подписывает кошелёк */
  wire: string;
  /** SHA-256 сообщения транзакции: подпись проверяется ровно под ним */
  messageHash: string;
}

/**
 * Memo-транзакция с текстом вызова. Плательщик комиссии — пользователь.
 *
 * Вторым обязательным подписантом стоит случайный ключ, от которого ни у кого нет
 * приватной части. Поэтому подписанную транзакцию невозможно отправить в сеть:
 * перехват не спишет с пользователя даже комиссию. Кошельки подписывают свою часть
 * частично подписанной транзакции — обычная практика для dApp-подписей.
 */
export const buildChallengeTransaction = (
  payer: Address,
  memo: string,
  blockhash: Blockhash,
): ChallengeTransaction => {
  const unsignable = createNoopSigner(
    getAddressDecoder().decode(randomBytes(32)),
  );
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(payer, tx),
    // Срок жизни нужен только чтобы кошелёк мог показать транзакцию: в сеть она не уходит
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash, lastValidBlockHeight: 0n },
        tx,
      ),
    (tx) =>
      appendTransactionMessageInstruction(
        getAddMemoInstruction({ memo, signers: [unsignable] }),
        tx,
      ),
  );
  const compiled = compileTransaction(message);
  return {
    wire: getBase64EncodedWireTransaction(compiled),
    messageHash: sha256Hex(new Uint8Array(compiled.messageBytes)),
  };
};

export interface SignedChallenge {
  messageBytes: Uint8Array;
  messageHash: string;
  signature: Uint8Array | null;
}

/** Разбирает подписанную транзакцию. null — не транзакция Solana. */
export const decodeSignedTransaction = (
  base64: string,
  signer: Address,
): SignedChallenge | null => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return null;
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_TRANSACTION_BYTES) {
    return null;
  }
  try {
    const transaction = getTransactionDecoder().decode(new Uint8Array(bytes));
    const messageBytes = new Uint8Array(transaction.messageBytes);
    const signature = transaction.signatures[signer];
    return {
      messageBytes,
      messageHash: sha256Hex(messageBytes),
      signature: signature ? new Uint8Array(signature) : null,
    };
  } catch {
    return null;
  }
};

/**
 * Кошелёк вправе дописать к транзакции служебные инструкции (лимит вычислений), и тогда
 * байты сообщения не совпадут с выданными. Такое сообщение принимаем только если:
 * плательщик — этот адрес, blockhash — выданный, нет таблиц адресов, есть ещё один
 * обязательный подписант (транзакцию нельзя отправить), а из программ — ровно один
 * memo с выданным текстом и, может быть, ComputeBudget.
 */
export const matchesChallengeMessage = (
  messageBytes: Uint8Array,
  expected: { payer: string; memo: string; blockhash: string },
): boolean => {
  try {
    const message = getCompiledTransactionMessageDecoder().decode(messageBytes);
    if (
      !('instructions' in message) ||
      message.staticAccounts[0] !== expected.payer
    ) {
      return false;
    }
    if (
      message.lifetimeToken !== expected.blockhash ||
      message.header.numSignerAccounts < 2
    ) {
      return false;
    }
    if (
      'addressTableLookups' in message &&
      (message.addressTableLookups?.length ?? 0) > 0
    ) {
      return false;
    }
    let memos = 0;
    for (const instruction of message.instructions) {
      const program = message.staticAccounts[instruction.programAddressIndex];
      if (program === MEMO_PROGRAM_ADDRESS) {
        memos += 1;
        const text = instruction.data
          ? getUtf8Decoder().decode(instruction.data)
          : '';
        if (text !== expected.memo) {
          return false;
        }
      } else if (program !== COMPUTE_BUDGET_PROGRAM) {
        return false;
      }
    }
    return memos === 1;
  } catch {
    return false;
  }
};

/** Ed25519: подпись адреса под байтами сообщения */
export const verifyEd25519 = async (
  signer: Address,
  signature: Uint8Array,
  messageBytes: Uint8Array,
): Promise<boolean> => {
  if (signature.length !== 64) {
    return false;
  }
  try {
    const publicKey = await getPublicKeyFromAddress(signer);
    return await verifySignature(
      publicKey,
      signature as Parameters<typeof verifySignature>[1],
      messageBytes,
    );
  } catch {
    return false;
  }
};

export const toAddress = (value: string): Address => address(value);
