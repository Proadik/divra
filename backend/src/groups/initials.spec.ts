import { freeName, initialsOf, isNameFrom, shortAddress } from './initials.js';

describe('initialsOf', () => {
  it.each([
    ['Ержан', 'Е'],
    ['анна ли', 'АЛ'],
    ['Анна Мария Ли', 'АМ'],
    ['Ccrt…KY47', 'C'],
    ['🙂 Друг', '🙂'],
    ['👨‍👩‍👧 Семья', '?'],
  ])('%s → %s', (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});

it('shortAddress', () => {
  expect(shortAddress('CcrtChiK8tg7JXKj9xFqWKwwgyTpAJC3sb91tvhiKY47')).toBe(
    'Ccrt…KY47',
  );
});

describe('freeName / isNameFrom', () => {
  it('занято — добавляет номер', () => {
    expect(freeName('Адиль', new Set())).toBe('Адиль');
    expect(freeName('Адиль', new Set(['адиль', 'адиль 2']))).toBe('Адиль 3');
  });

  it('узнаёт имя по умолчанию и его нумерованный вариант', () => {
    expect(isNameFrom('Ccrt…KY47', 'Ccrt…KY47')).toBe(true);
    expect(isNameFrom('Ccrt…KY47 2', 'Ccrt…KY47')).toBe(true);
    expect(isNameFrom('Ccrt…KY47 два', 'Ccrt…KY47')).toBe(false);
    expect(isNameFrom('Шеф', 'Ccrt…KY47')).toBe(false);
  });
});
