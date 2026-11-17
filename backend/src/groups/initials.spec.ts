import { initialsOf, shortAddress } from './initials.js';

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
