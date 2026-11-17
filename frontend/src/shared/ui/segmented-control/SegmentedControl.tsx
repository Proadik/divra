import type { ReactElement } from 'react'
import { cx } from '@/shared/lib/classnames'
import './segmented-control.css'

export type SegmentOption<T extends string> = {
  value: T
  label: string
}

export type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (value: T) => void
  /** Подпись группы для скринридеров */
  label: string
}

/** 2–4 коротких варианта, например способ деления: Поровну / Точно / % / Доли */
export const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>): ReactElement => {
  return (
    <div className="sp-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const isOn = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isOn}
            className={cx('sp-seg__item', isOn && 'is-on')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
