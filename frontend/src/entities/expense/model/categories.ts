import type { ExpenseCategory } from '@/shared/api'
import type { IconName } from '@/shared/ui'

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  'food',
  'groceries',
  'transport',
  'housing',
  'fun',
  'other',
]

export const CATEGORY_ICONS: Record<ExpenseCategory, IconName> = {
  transport: 'fuel',
  housing: 'home',
  food: 'utensils',
  groceries: 'cart',
  fun: 'ticket',
  other: 'receipt-scan',
}

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  transport: 'Транспорт',
  housing: 'Жильё',
  food: 'Еда',
  groceries: 'Продукты',
  fun: 'Досуг',
  other: 'Другое',
}
