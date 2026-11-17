import type { ComponentProps, ReactElement } from 'react'
import { cx } from '@/shared/lib/classnames'
import './checkbox.css'

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'>

/** Всегда внутри <label> вместе с аватаром и именем — вся строка становится тач-зоной. */
export const Checkbox = ({ className, ...rest }: CheckboxProps): ReactElement => {
  return <input type="checkbox" className={cx('sp-check', className)} {...rest} />
}
