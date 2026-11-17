import type { ReactElement } from 'react'
import { CATEGORY_ICONS, CATEGORY_LABELS, EXPENSE_CATEGORIES } from '@/entities/expense'
import type { ExpenseCategory } from '@/shared/api'
import { cx } from '@/shared/lib/classnames'
import { Icon } from '@/shared/ui'

export type CategoryPickerProps = {
  value: ExpenseCategory
  onChange: (value: ExpenseCategory) => void
}

export const CategoryPicker = ({ value, onChange }: CategoryPickerProps): ReactElement => {
  return (
    <div className="add-expense__categories" role="radiogroup" aria-label="Категория">
      {EXPENSE_CATEGORIES.map((category) => (
        <button
          key={category}
          type="button"
          role="radio"
          aria-checked={category === value}
          className={cx('add-expense__category', category === value && 'is-on')}
          onClick={() => onChange(category)}
        >
          <Icon name={CATEGORY_ICONS[category]} />
          {CATEGORY_LABELS[category]}
        </button>
      ))}
    </div>
  )
}
