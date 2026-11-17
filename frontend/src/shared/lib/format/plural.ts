const rules = new Intl.PluralRules('ru-RU')

export type PluralForms = { one: string; few: string; many: string }

/** pluralize(3, { one: 'перевод', few: 'перевода', many: 'переводов' }) → «3 перевода» */
export const pluralize = (count: number, forms: PluralForms): string => {
  const rule = rules.select(count)
  const word = rule === 'one' ? forms.one : rule === 'few' ? forms.few : forms.many
  return `${count} ${word}`
}
