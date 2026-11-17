import { debtsOf, netDebts } from './ledger.js';

describe('netDebts', () => {
  it('зачитывает встречные долги и складывает однонаправленные', () => {
    expect(
      netDebts([
        { fromId: 'a', toId: 'b', cents: 3000 },
        { fromId: 'b', toId: 'a', cents: 1000 },
        { fromId: 'c', toId: 'b', cents: 500 },
        { fromId: 'c', toId: 'b', cents: 250 },
      ]),
    ).toEqual(
      expect.arrayContaining([
        { fromId: 'a', toId: 'b', cents: 2000 },
        { fromId: 'c', toId: 'b', cents: 750 },
      ]),
    );
  });

  it('полностью зачтённая пара и долг самому себе исчезают', () => {
    expect(
      netDebts([
        { fromId: 'a', toId: 'b', cents: 1000 },
        { fromId: 'b', toId: 'a', cents: 1000 },
        { fromId: 'a', toId: 'a', cents: 500 },
      ]),
    ).toEqual([]);
  });

  it('направление не зависит от порядка id', () => {
    expect(netDebts([{ fromId: 'z', toId: 'a', cents: 1 }])).toEqual([
      { fromId: 'z', toId: 'a', cents: 1 },
    ]);
  });
});

it('debtsOf: баланс и суммы участника', () => {
  const debts = [
    { fromId: 'me', toId: 'b', cents: 1000 },
    { fromId: 'c', toId: 'me', cents: 2500 },
    { fromId: 'c', toId: 'b', cents: 700 },
  ];
  expect(debtsOf(debts, 'me')).toEqual({
    debts: debts.slice(0, 2),
    balanceCents: 1500,
    owedToCents: 2500,
    owesCents: 1000,
  });
});
