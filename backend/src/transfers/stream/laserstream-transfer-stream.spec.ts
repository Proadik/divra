import { getBase58Encoder } from '@solana/kit';
import type { SubscribeUpdate } from 'helius-laserstream';
import { balanceChanges, observedOf } from './laserstream-transfer-stream.js';

const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const ALICE = 'En8us9A5d7H27SRP57bwt3Cv63Z57q34DkcLh5Vs1KFY';
const BOB = '9TUWQuE2YXwyiBgdKsj4cNZepoPGSqHathf8bUyjBzrf';
const bytes = (value: string): Buffer =>
  Buffer.from(getBase58Encoder().encode(value));

const balance = (owner: string, amount: string, mint = MINT) => ({
  owner,
  mint,
  uiTokenAmount: { amount },
});

describe('balanceChanges', () => {
  it('после − до по владельцу и mint, без нулевых', () => {
    expect(
      balanceChanges(
        [balance(ALICE, '50000000'), balance(BOB, '0'), balance(BOB, '7', 'x')],
        [
          balance(ALICE, '20000000'),
          balance(BOB, '30000000'),
          balance(BOB, '7', 'x'),
        ],
      ),
    ).toEqual([
      { owner: ALICE, mint: MINT, delta: -30_000_000n },
      { owner: BOB, mint: MINT, delta: 30_000_000n },
    ]);
  });

  it('новый токен-аккаунт: в pre его нет', () => {
    expect(balanceChanges([], [balance(BOB, '5')])).toEqual([
      { owner: BOB, mint: MINT, delta: 5n },
    ]);
  });
});

describe('observedOf', () => {
  const update = (err: unknown = null): SubscribeUpdate =>
    ({
      transaction: {
        slot: '123',
        transaction: {
          signature: bytes(ALICE),
          transaction: { message: { accountKeys: [bytes(ALICE), bytes(BOB)] } },
          meta: {
            err,
            loadedWritableAddresses: [],
            loadedReadonlyAddresses: [bytes(MINT)],
            preTokenBalances: [balance(ALICE, '10')],
            postTokenBalances: [balance(ALICE, '4'), balance(BOB, '6')],
          },
        },
      },
    }) as unknown as SubscribeUpdate;

  it('разбирает подпись, аккаунты (вместе с lookup-таблицами) и изменения балансов', () => {
    expect(observedOf(update())).toEqual({
      signature: ALICE,
      slot: 123,
      accounts: [ALICE, BOB, MINT],
      changes: [
        { owner: ALICE, mint: MINT, delta: -6n },
        { owner: BOB, mint: MINT, delta: 6n },
      ],
    });
  });

  it('ошибочная транзакция и не-транзакция — null', () => {
    expect(observedOf(update({ err: 'x' }))).toBeNull();
    expect(
      observedOf({ slot: { slot: '1' } } as unknown as SubscribeUpdate),
    ).toBeNull();
  });
});
