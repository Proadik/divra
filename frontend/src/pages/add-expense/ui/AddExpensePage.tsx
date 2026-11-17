import { type ReactElement, useId } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useStablecoin } from '@/entities/currency'
import { FIAT_CURRENCIES, FIAT_SYMBOLS, type FiatCurrency, groupPath } from '@/shared/config'
import { formatAmount } from '@/shared/lib/format'
import { Button, Icon, IconButton, SegmentedControl, TextField } from '@/shared/ui'
import { amountMasks } from '../lib/masks'
import type { SplitResult } from '../lib/split'
import { useExpenseForm } from '../model/use-expense-form'
import { CategoryPicker } from './CategoryPicker'
import { MaskedInput } from './MaskedInput'
import { SplitMembers } from './SplitMembers'
import './AddExpensePage.css'

const SPLIT_OPTIONS = [
  { value: 'equal', label: 'Поровну' },
  { value: 'exact', label: 'Точно' },
  { value: 'percent', label: '%' },
  { value: 'shares', label: 'Доли' },
] as const

const splitHint = (
  split: SplitResult,
  symbol: string,
  fractionDigits: 0 | 2,
): { text: string; tone: 'ok' | 'warn' } | null => {
  if (split.ok) {
    return { text: 'Сумма распределена полностью', tone: 'ok' }
  }
  const left = split.remainder ?? 0
  if (split.reason === 'exact-mismatch') {
    const amount = `${formatAmount(left / 100, fractionDigits)} ${symbol}`
    const text = left > 0 ? `Осталось распределить ${amount}` : `Больше суммы на ${amount}`
    return { text, tone: 'warn' }
  }
  if (split.reason === 'percent-mismatch') {
    return left > 0
      ? { text: `Осталось распределить ${formatAmount(left / 100)}%`, tone: 'warn' }
      : { text: `Больше 100% на ${formatAmount(-left / 100)}%`, tone: 'warn' }
  }
  return null
}

export const AddExpensePage = (): ReactElement => {
  const { groupId = '' } = useParams()
  const navigate = useNavigate()
  const payerId = useId()
  const amountId = useId()
  const stablecoin = useStablecoin()
  const goHome = (): void => {
    void navigate(groupPath(groupId))
  }
  const form = useExpenseForm(groupId, goHome)
  const { values } = form
  const symbol = FIAT_SYMBOLS[values.currency]
  const hint = splitHint(form.split, symbol, form.fractionDigits)
  const rateText =
    form.rate && values.currency !== 'USD'
      ? `1 USD = ${formatAmount(form.rate)} ${symbol}`
      : `1 USD = 1 ${stablecoin}`
  const equivalent = ((): string => {
    if (form.rateStatus === 'pending') {
      return 'Загружаем курс…'
    }
    if (form.rateStatus === 'error') {
      return 'Курс недоступен'
    }
    return form.stableCents === null
      ? rateText
      : `≈ ${formatAmount(form.stableCents / 100)} ${stablecoin} · ${rateText}`
  })()

  return (
    <main className="add-expense page-enter">
      <header className="add-expense__header">
        <IconButton icon="close" label="Закрыть" onClick={goHome} />
        <h1 className="add-expense__title">Новый расход</h1>
        <span className="add-expense__spacer" aria-hidden />
      </header>

      <div className="add-expense__amount">
        <label htmlFor={amountId} className="add-expense__amount-label">
          Сумма
        </label>
        <span className="add-expense__amount-row">
          <MaskedInput
            id={amountId}
            mask={amountMasks[form.fractionDigits]}
            value={values.amountText}
            onValueChange={(text) => form.set('amountText', text)}
            placeholder={form.fractionDigits === 0 ? '0' : '0.00'}
            className="add-expense__amount-input"
            size={Math.max(4, values.amountText.length || 4)}
          />
          <span className="add-expense__currency">
            <select
              aria-label="Валюта суммы"
              className="add-expense__currency-select"
              value={values.currency}
              onChange={(event) => form.set('currency', event.currentTarget.value as FiatCurrency)}
            >
              {FIAT_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" size={14} />
          </span>
        </span>
        <p className="add-expense__equiv" aria-live="polite">
          {equivalent}
        </p>
      </div>

      <div className="sp-listgroup">
        <TextField
          label="Что"
          placeholder="Например, ужин у костра"
          value={values.title}
          maxLength={60}
          onChange={(event) => form.set('title', event.currentTarget.value)}
        />
        <label className="sp-field" htmlFor={payerId}>
          <span className="sp-field__label">Платил</span>
          <select
            id={payerId}
            className="add-expense__select"
            value={values.paidById}
            onChange={(event) => form.set('paidById', event.currentTarget.value)}
          >
            {form.members?.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={16} />
        </label>
      </div>

      <CategoryPicker
        value={values.category}
        onChange={(category) => form.set('category', category)}
      />

      {/* TODO: OCR чека — разбивка по позициям */}
      <button type="button" className="add-expense__scan" disabled>
        <span className="add-expense__scan-icon">
          <Icon name="receipt-scan" />
        </span>
        <span className="add-expense__scan-text">
          <span className="add-expense__scan-title">Сканировать чек</span>
          <span className="add-expense__scan-sub">Скоро: разобьём по позициям автоматически</span>
        </span>
      </button>

      <section className="add-expense__section" aria-labelledby="split-title">
        <h2 id="split-title" className="add-expense__section-title">
          Как делим
        </h2>
        <SegmentedControl
          label="Способ деления"
          options={SPLIT_OPTIONS}
          value={values.mode}
          onChange={(mode) => form.set('mode', mode)}
        />
        {form.members && (
          <SplitMembers
            members={form.members}
            mode={values.mode}
            selected={values.selected}
            splitTexts={values.splitTexts}
            split={form.split}
            unit={symbol}
            fractionDigits={form.fractionDigits}
            onToggle={form.toggleMember}
            onTextChange={form.setSplitText}
          />
        )}
        {hint && values.amountText && (
          <p className={`add-expense__hint add-expense__hint--${hint.tone}`} role="status">
            {hint.text}
          </p>
        )}
      </section>

      <div className="add-expense__footer page-enter-action">
        {(form.submitError || (!form.payload.ok && form.payload.message)) && (
          <p className="add-expense__error" role="alert">
            {form.submitError
              ? 'Не удалось сохранить расход. Попробуй ещё раз.'
              : form.payload.ok
                ? null
                : form.payload.message}
          </p>
        )}
        <Button
          size="lg"
          block
          disabled={!form.payload.ok || form.isSubmitting}
          onClick={form.submit}
        >
          {form.isSubmitting ? 'Сохраняем…' : 'Сохранить расход'}
        </Button>
      </div>
    </main>
  )
}
