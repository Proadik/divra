import type { MaskitoOptions } from '@maskito/core'
import { useMaskito } from '@maskito/react'
import type { ComponentProps, ReactElement } from 'react'

export type MaskedInputProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'ref'> & {
  /** Объект маски должен быть стабильным (создан вне компонента) */
  mask: MaskitoOptions
  value: string
  onValueChange: (value: string) => void
}

/** Поле с маской Maskito. Значение — отформатированная строка; число получаем через maskitoParseNumber. */
export const MaskedInput = ({
  mask,
  value,
  onValueChange,
  ...rest
}: MaskedInputProps): ReactElement => {
  const ref = useMaskito({ options: mask })
  return (
    <input
      inputMode="decimal"
      autoComplete="off"
      {...rest}
      ref={ref}
      value={value}
      // Maskito меняет значение сам и шлёт событие input — React-у слушаем именно его
      onInput={(event) => onValueChange(event.currentTarget.value)}
      onChange={() => undefined}
    />
  )
}
