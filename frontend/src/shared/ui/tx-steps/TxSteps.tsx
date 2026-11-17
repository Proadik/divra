import type { ReactElement } from 'react'
import { cx } from '@/shared/lib/classnames'
import { Icon } from '../icon'
import './tx-steps.css'

export type TxStep = {
  label: string
  state: 'done' | 'active' | 'todo'
  /** Подсказка только у активного шага, человеческими словами */
  hint?: string
}

export type TxStepsProps = {
  steps: TxStep[]
}

/** Подпись → подтверждение сетью → финализация */
export const TxSteps = ({ steps }: TxStepsProps): ReactElement => {
  return (
    <ol className="sp-steps">
      {steps.map((step, index) => (
        <li key={step.label} className={cx('sp-step', `sp-step--${step.state}`)}>
          <span className="sp-step__rail">
            <span className="sp-step__dot">
              {step.state === 'done' && <Icon name="check" size={14} strokeWidth={3} />}
            </span>
            {index < steps.length - 1 && <span className="sp-step__line" />}
          </span>
          <span className="sp-step__body">
            <span className="sp-step__label">{step.label}</span>
            {step.hint && <span className="sp-step__hint">{step.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
