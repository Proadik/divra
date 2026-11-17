const DAY_MS = 86_400_000

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })

/** «сегодня», «вчера» или «14 нояб.» */
export const formatRelativeDay = (iso: string, now: Date = new Date()): string => {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY_MS)
  if (days === 0) {
    return 'сегодня'
  }
  if (days === 1) {
    return 'вчера'
  }
  return dayMonth.format(new Date(iso))
}
