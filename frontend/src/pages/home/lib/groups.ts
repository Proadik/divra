import type { Activity, GroupKind } from '@/shared/api'
import type { IconName } from '@/shared/ui'

export const GROUP_KIND_ICONS: Record<GroupKind, IconName> = {
  trip: 'mountain',
  home: 'home',
  food: 'utensils',
  other: 'users',
}

export const GROUP_KIND_OPTIONS = [
  { value: 'trip', label: 'Поездка' },
  { value: 'home', label: 'Жильё' },
  { value: 'food', label: 'Еда' },
  { value: 'other', label: 'Другое' },
] as const satisfies ReadonlyArray<{ value: GroupKind; label: string }>

/** Подпись под балансом группы в списке */
export const balanceNote = (balance: number): string => {
  if (balance > 0) {
    return 'тебе должны'
  }
  return balance < 0 ? 'ты должен' : 'рассчитались'
}

/** Заголовок строки «Недавнее» */
export const activityTitle = (item: Activity): string => {
  if (item.type === 'expense') {
    return item.title ?? 'Расход'
  }
  if (item.counterpart?.isMe) {
    return `Перевод от ${item.actor.name}`
  }
  return item.actor.isMe ? `Твой перевод: ${item.counterpart?.name ?? 'участник'}` : 'Перевод'
}
