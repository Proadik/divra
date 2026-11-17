/** Сырой долг: from должен to столько центов (сумма долей по расходам, без зачёта) */
export interface DebtTotal {
  fromId: string;
  toId: string;
  cents: number;
}

/**
 * Взаимозачёт по парам: если А должен Б 30, а Б должен А 10 — остаётся «А должен Б 20».
 * Считается из расходов при каждом чтении, отдельного «журнала долгов» нет —
 * нечему разойтись с расходами.
 */
export const netDebts = (totals: DebtTotal[]): DebtTotal[] => {
  const net = new Map<string, number>();
  for (const { fromId, toId, cents } of totals) {
    if (fromId === toId || cents === 0) {
      continue;
    }
    // Ключ пары в каноническом порядке; знак — направление долга
    const [a, b, sign] = fromId < toId ? [fromId, toId, 1] : [toId, fromId, -1];
    const key = `${a}>${b}`;
    net.set(key, (net.get(key) ?? 0) + sign * cents);
  }
  const debts: DebtTotal[] = [];
  for (const [key, cents] of net) {
    const [a = '', b = ''] = key.split('>');
    if (cents > 0) {
      debts.push({ fromId: a, toId: b, cents });
    } else if (cents < 0) {
      debts.push({ fromId: b, toId: a, cents: -cents });
    }
  }
  return debts;
};

/** Долги с участием участника и его баланс: > 0 — ему должны */
export const debtsOf = (
  debts: DebtTotal[],
  memberId: string,
): {
  debts: DebtTotal[];
  balanceCents: number;
  owedToCents: number;
  owesCents: number;
} => {
  const mine = debts.filter(
    (debt) => debt.fromId === memberId || debt.toId === memberId,
  );
  let owedToCents = 0;
  let owesCents = 0;
  for (const debt of mine) {
    if (debt.toId === memberId) {
      owedToCents += debt.cents;
    } else {
      owesCents += debt.cents;
    }
  }
  return {
    debts: mine,
    balanceCents: owedToCents - owesCents,
    owedToCents,
    owesCents,
  };
};
