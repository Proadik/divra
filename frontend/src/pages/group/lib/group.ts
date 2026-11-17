import type { GroupMember, GroupOverview } from '@/shared/api'
import type { AvatarTone, Person } from '@/shared/ui'

export const findMember = (group: GroupOverview, id: string): GroupMember | undefined =>
  group.members.find((member) => member.id === id)

/** Цвет аватара по порядку участника в группе — внутри группы цвета не повторяются (до 4 человек). */
export const toneOf = (group: GroupOverview, memberId: string): AvatarTone =>
  ((Math.max(
    0,
    group.members.findIndex((member) => member.id === memberId),
  ) %
    4) +
    1) as AvatarTone

export const toPerson = (group: GroupOverview, member: GroupMember): Person => ({
  initials: member.initials,
  tone: toneOf(group, member.id),
  name: member.name,
})

export const balanceCaption = (balance: number): string => {
  if (balance > 0) {
    return 'Тебе должны в этой группе'
  }
  return balance < 0 ? 'Ты должен в этой группе' : 'Все в расчёте'
}
