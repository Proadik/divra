import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
} from '@solana-program/token';
import {
  AccountRole,
  type Address,
  type Blockhash,
  type Instruction,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';

/** Больше пакета Solana транзакция не бывает */
const MAX_TRANSACTION_BYTES = 1232;
/** У USDC и USDT 6 знаков после запятой */
export const STABLECOIN_DECIMALS = 6;

export interface TransfersTransactionInput {
  payer: Address;
  mint: Address;
  reference: Address;
  blockhash: Blockhash;
  transfers: ReadonlyArray<{ recipient: Address; rawAmount: bigint }>;
}

export interface PaymentTransactionInput {
  payer: Address;
  recipient: Address;
  mint: Address;
  rawAmount: bigint;
  reference: Address;
  blockhash: Blockhash;
}

/**
 * Переводы токена получателям одной транзакцией, как их описывает Solana Pay:
 * transferChecked на каждого и reference — лишний read-only ключ в первой инструкции
 * перевода, по нему бэкенд отличает свою транзакцию. Токен-аккаунт получателя создаётся,
 * если его ещё нет (идемпотентно, аренду платит плательщик). Подписывает только плательщик.
 */
export const buildTransfersTransaction = async (
  input: TransfersTransactionInput,
): Promise<string> => {
  const payer = createNoopSigner(input.payer);
  const [source] = await findAssociatedTokenPda({
    owner: input.payer,
    mint: input.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const instructions: Instruction[] = [];
  for (const [index, item] of input.transfers.entries()) {
    const destination = await recipientTokenAccount(item.recipient, input.mint);
    instructions.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer,
        ata: destination,
        owner: item.recipient,
        mint: input.mint,
      }),
    );
    const transfer = getTransferCheckedInstruction({
      source,
      mint: input.mint,
      destination,
      authority: payer,
      amount: item.rawAmount,
      decimals: STABLECOIN_DECIMALS,
    });
    instructions.push(
      index === 0
        ? {
            ...transfer,
            accounts: [
              ...transfer.accounts,
              { address: input.reference, role: AccountRole.READONLY },
            ],
          }
        : transfer,
    );
  }
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: input.blockhash, lastValidBlockHeight: 0n },
        tx,
      ),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
  const compiled = compileTransaction(message);
  return getBase64EncodedWireTransaction(compiled);
};

/** Перевод по запросу (Solana Pay): один получатель */
export const buildPaymentTransaction = (
  input: PaymentTransactionInput,
): Promise<string> =>
  buildTransfersTransaction({
    payer: input.payer,
    mint: input.mint,
    reference: input.reference,
    blockhash: input.blockhash,
    transfers: [{ recipient: input.recipient, rawAmount: input.rawAmount }],
  });

/** Влезает ли транзакция в пакет Solana */
export const fitsInPacket = (base64: string): boolean =>
  Buffer.from(base64, 'base64').length <= MAX_TRANSACTION_BYTES;

/** Адрес токен-аккаунта получателя — для проверки транзакции перед отправкой */
export const recipientTokenAccount = async (
  recipient: Address,
  mint: Address,
): Promise<Address> =>
  (
    await findAssociatedTokenPda({
      owner: recipient,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    })
  )[0];

/**
 * Подписанная транзакция, которую отправит бэкенд. Проверяем, что это перевод именно
 * по этому запросу (есть reference, токен-аккаунт получателя и программа токенов) — чтобы
 * эндпоинт не стал бесплатным ретранслятором чужих транзакций. Что деньги реально
 * дошли, всё равно решает поиск в сети после подтверждения.
 */
export const isPaymentTransaction = (
  base64: string,
  expected: { reference: Address; destination: Address },
): boolean =>
  isTransfersTransaction(base64, {
    reference: expected.reference,
    destinations: [expected.destination],
  });

/** То же для расчёта: reference и токен-аккаунты всех получателей */
export const isTransfersTransaction = (
  base64: string,
  expected: { reference: Address; destinations: readonly Address[] },
): boolean => {
  try {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_TRANSACTION_BYTES) {
      return false;
    }
    const transaction = getTransactionDecoder().decode(bytes);
    const message = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    );
    const keys = new Set<string>(message.staticAccounts);
    return (
      keys.has(expected.reference) &&
      expected.destinations.every((destination) => keys.has(destination)) &&
      keys.has(TOKEN_PROGRAM_ADDRESS) &&
      Object.values(transaction.signatures).some(
        (signature) => signature !== null,
      )
    );
  } catch {
    return false;
  }
};
