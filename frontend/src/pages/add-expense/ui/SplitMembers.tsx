import type { ReactElement } from 'react'
import type { GroupMember, SplitMode } from '@/shared/api'
import { formatAmount } from '@/shared/lib/format'
import { Avatar, type AvatarTone, Checkbox } from '@/shared/ui'
import { splitMaskOf } from '../lib/masks'
import type { SplitResult } from '../lib/split'
import { MaskedInput } from './MaskedInput'

const suffixOf = (mode: Exclude<SplitMode, 'equal'>, unit: string): string =>
  mode === 'exact' ? unit : mode === 'percent' ? '%' : 'доли'

export type SplitMembersProps = {
  members: readonly GroupMember[]
  mode: SplitMode
  selected: readonly string[]
  splitTexts: Readonly<Record<string, string>>
  split: SplitResult
  /** Символ валюты ввода: ₸, ₽, €, $ */
  unit: string
  /** Знаков после запятой у валюты ввода */
  fractionDigits: 0 | 2
  onToggle: (memberId: string) => void
  onTextChange: (memberId: string, text: string) => void
}

const toneOf = (index: number): AvatarTone => ((index % 4) + 1) as AvatarTone

export const SplitMembers = ({
  members,
  mode,
  selected,
  splitTexts,
  split,
  unit,
  fractionDigits,
  onToggle,
  onTextChange,
}: SplitMembersProps): ReactElement => {
  const shareOf = (memberId: string): string | null => {
    if (!split.ok) {
      return null
    }
    const share = split.shares.find((item) => item.memberId === memberId)
    return share ? formatAmount(share.cents / 100, fractionDigits) : null
  }

  return (
    <div className="sp-listgroup">
      {members.map((member, index) => {
        const isOn = selected.includes(member.id)
        const share = isOn ? shareOf(member.id) : null
        return (
          <div key={member.id} className="sp-row add-expense__member">
            <label className="add-expense__member-label">
              <Checkbox checked={isOn} onChange={() => onToggle(member.id)} />
              <Avatar initials={member.initials} tone={toneOf(index)} size="sm" />
              <span className="sp-row__title">{member.name}</span>
            </label>

            <span className="sp-row__trail">
              {mode === 'equal' || !isOn ? (
                <span className={isOn ? undefined : 'add-expense__muted'}>
                  {share ? `${share} ${unit}` : '—'}
                </span>
              ) : (
                <>
                  <span className="add-expense__split-input">
                    <MaskedInput
                      mask={splitMaskOf(mode, fractionDigits)}
                      value={splitTexts[member.id] ?? ''}
                      onValueChange={(text) => onTextChange(member.id, text)}
                      inputMode={mode === 'shares' ? 'numeric' : 'decimal'}
                      placeholder="0"
                      aria-label={`${member.name}: ${suffixOf(mode, unit)}`}
                    />
                    <span className="add-expense__suffix">{suffixOf(mode, unit)}</span>
                  </span>
                  {mode !== 'exact' && share && (
                    <span className="add-expense__muted">
                      {share} {unit}
                    </span>
                  )}
                </>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
