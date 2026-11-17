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
