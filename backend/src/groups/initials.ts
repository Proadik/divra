const graphemes = new Intl.Segmenter('ru', { granularity: 'grapheme' });

const firstGrapheme = (word: string): string =>
  graphemes.segment(word)[Symbol.iterator]().next().value?.segment ?? '';

/**
 * «Ержан» → «Е», «Анна Ли» → «АЛ», «Ccrt…KY47» → «C».
 * Не длиннее 2 UTF-16 символов (контракт фронтенда): эмодзи-первая буква — одна.
 */
export const initialsOf = (name: string): string => {
  let initials = '';
  for (const word of name.split(' ').slice(0, 2)) {
    const letter = firstGrapheme(word).toUpperCase();
    if (initials.length + letter.length > 2) {
      break;
    }
    initials += letter;
  }
  return initials || '?';
};

/** Имя по умолчанию для того, кто ещё не представился: «Ccrt…KY47» */
export const shortAddress = (address: string): string =>
  `${address.slice(0, 4)}…${address.slice(-4)}`;

/** Имя, которого ещё нет в группе: «Ccrt…KY47», при совпадении — «Ccrt…KY47 2» */
export const freeName = (base: string, taken: ReadonlySet<string>): string => {
  for (let index = 1; index < 100; index += 1) {
    const candidate = index === 1 ? base : `${base.slice(0, 28)} ${index}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${base.slice(0, 22)} ${Date.now() % 1_000_000}`;
};

/** Имя получено из base функцией freeName: «base» или «base 2» */
export const isNameFrom = (name: string, base: string): boolean => {
  if (name === base) {
    return true;
  }
  const prefix = `${base.slice(0, 28)} `;
  return name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length));
};
