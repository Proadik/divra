import { randomBytes } from 'node:crypto';
import { getAddMemoInstruction } from '@solana-program/memo';
import {
  type Address,
  type Blockhash,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPair,
  getAddressDecoder,
  getAddressFromPublicKey,
  getTransactionDecoder,
  pipe,
  prependTransactionMessageInstruction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import {
  buildChallengeTransaction,
  decodeSignedTransaction,
  matchesChallengeMessage,
} from './challenge-transaction.js';

const randomAddress = (): Address =>
  getAddressDecoder().decode(randomBytes(32));
const blockhash = randomAddress() as unknown as Blockhash;
const memo = 'Divra: вход\nNonce: 00ff';

/** Сообщение, каким его мог бы пересобрать кошелёк, с дополнительной инструкцией в начале */
const walletModified = (
  payer: Address,
  extraProgram: Address,
  memoText = memo,
  signers = 1,
): Uint8Array => {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(payer, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash, lastValidBlockHeight: 0n },
        tx,
      ),
    (tx) =>
      appendTransactionMessageInstruction(
        getAddMemoInstruction({
          memo: memoText,
          signers: Array.from({ length: signers }, () =>
            createNoopSigner(randomAddress()),
          ),
        }),
        tx,
      ),
    (tx) =>
      prependTransactionMessageInstruction(
        { programAddress: extraProgram, data: new Uint8Array([2, 0, 0, 0, 0]) },
        tx,
      ),
  );
  return new Uint8Array(compileTransaction(message).messageBytes);
};

describe('транзакция-вызов', () => {
  it('требует второго подписанта — отправить её в сеть нельзя', async () => {
    const payer = await getAddressFromPublicKey(
      (await generateKeyPair()).publicKey,
    );
    const { wire } = buildChallengeTransaction(payer, memo, blockhash);
    const transaction = getTransactionDecoder().decode(
      Buffer.from(wire, 'base64'),
    );

    expect(Object.keys(transaction.signatures)).toHaveLength(2);
    expect(Object.keys(transaction.signatures)).toContain(payer);
  });

  it('принимает сообщение с добавленной кошельком ComputeBudget-инструкцией', () => {
    const payer = randomAddress();
    const bytes = walletModified(
      payer,
      address('ComputeBudget111111111111111111111111111111'),
    );

    expect(matchesChallengeMessage(bytes, { payer, memo, blockhash })).toBe(
      true,
    );
  });

  it('отклоняет любую другую программу, чужой текст, чужого плательщика и отправляемую транзакцию', () => {
    const payer = randomAddress();
    const budget = address('ComputeBudget111111111111111111111111111111');
    const system = address('11111111111111111111111111111111');

    expect(
      matchesChallengeMessage(walletModified(payer, system), {
        payer,
        memo,
        blockhash,
      }),
    ).toBe(false);
    expect(
      matchesChallengeMessage(walletModified(payer, budget, 'другой текст'), {
        payer,
        memo,
        blockhash,
      }),
    ).toBe(false);
    expect(
      matchesChallengeMessage(walletModified(randomAddress(), budget), {
        payer,
        memo,
        blockhash,
      }),
    ).toBe(false);
    expect(
      matchesChallengeMessage(walletModified(payer, budget, memo, 0), {
        payer,
        memo,
        blockhash,
      }),
    ).toBe(false);
  });

  it('не разбирает мусор и слишком длинные данные', () => {
    const signer = randomAddress();
    expect(decodeSignedTransaction('не base64!', signer)).toBeNull();
    expect(
      decodeSignedTransaction(Buffer.alloc(2000).toString('base64'), signer),
    ).toBeNull();
    expect(
      decodeSignedTransaction(
        Buffer.from([1, 2, 3]).toString('base64'),
        signer,
      ),
    ).toBeNull();
  });
});
