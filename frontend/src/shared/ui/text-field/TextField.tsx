import { type ComponentProps, type ReactElement, useId } from 'react'
import { cx } from '@/shared/lib/classnames'
import './text-field.css'

export type TextFieldProps = ComponentProps<'input'> & {
  label: string
}

/** Поле-строка внутри ListGroup: подпись слева, значение справа. */
export const TextField = ({ label, className, id, ...rest }: TextFieldProps): ReactElement => {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <label className={cx('sp-field', className)} htmlFor={inputId}>
      <span className="sp-field__label">{label}</span>
      <input id={inputId} className="sp-field__input" {...rest} />
    </label>
  )
}
