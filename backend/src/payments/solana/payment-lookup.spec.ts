import { deltasByOwner, receivedAmount } from './payment-lookup.js';

const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const ME = 'CcrtChiK8tg7JXKj9xFqWKwwgyTpAJC3sb91tvhiKY47';
const PAYER = '6S1KhJ1wE7r8Hn2vGq8ycpk5yKzz4JyYv1kz7mCwuwuE';

const balance = (owner: string, amount: string, mint = MINT) => ({
  accountIndex: 1,
  mint,
  owner,
  uiTokenAmount: { amount },
});

describe('receivedAmount', () => {
  it('рост баланса получателя в этом токене', () => {
    expect(
      receivedAmount(
        {
          preTokenBalances: [
            balance(ME, '1000000'),
            balance(PAYER, '50000000'),
          ],
          postTokenBalances: [
            balance(ME, '31000000'),
            balance(PAYER, '20000000'),
          ],
        },
        { recipient: ME, mint: MINT },
      ),
    ).toBe(30_000_000n);
  });

  it('токен-аккаунт создан в этой транзакции — «до» нет', () => {
    expect(
      receivedAmount(
        { preTokenBalances: [], postTokenBalances: [balance(ME, '30000000')] },
        { recipient: ME, mint: MINT },
      ),
    ).toBe(30_000_000n);
  });

  it('другой токен или другой владелец не считаются', () => {
    expect(
      receivedAmount(
        {
          preTokenBalances: [],
          postTokenBalances: [
            balance(
              ME,
              '30000000',
              'So11111111111111111111111111111111111111112',
            ),
            balance(PAYER, '30000000'),
          ],
        },
        { recipient: ME, mint: MINT },
      ),
    ).toBe(0n);
  });

  it('отправил, а не получил — отрицательно', () => {
    expect(
      receivedAmount(
        {
          preTokenBalances: [balance(ME, '30000000')],
          postTokenBalances: [balance(ME, '0')],
        },
        { recipient: ME, mint: MINT },
      ),
    ).toBe(-30_000_000n);
  });
});

it('deltasByOwner: изменения по каждому владельцу в одном токене', () => {
  const deltas = deltasByOwner(
    {
      preTokenBalances: [balance(PAYER, '50000000'), balance(ME, '1000000')],
      postTokenBalances: [
        balance(PAYER, '0'),
        balance(ME, '31000000'),
        balance('Friend111111111111111111111111111111111111', '20000000'),
        balance(ME, '999', 'So11111111111111111111111111111111111111112'),
      ],
    },
    MINT,
  );
  expect(Object.fromEntries(deltas)).toEqual({
    [PAYER]: -50_000_000n,
    [ME]: 30_000_000n,
    Friend111111111111111111111111111111111111: 20_000_000n,
  });
});
