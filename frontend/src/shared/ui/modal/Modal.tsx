import { type ReactElement, type ReactNode, useEffect, useId, useRef } from 'react'
import './modal.css'

export type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  children?: ReactNode
  /** Кнопки внизу; первая по порядку — главное действие */
  actions?: ReactNode
}

/**
 * Модальное окно на нативном <dialog>: фокус внутри окна, Esc закрывает,
 * остальная страница недоступна для кликов и скринридеров. Клик по фону тоже закрывает.
 */
export const Modal = ({ open, onClose, title, children, actions }: ModalProps): ReactElement => {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) {
      return
    }
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal()
      } else {
        dialog.setAttribute('open', '')
      }
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close()
      } else {
        dialog.removeAttribute('open')
      }
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      className="sp-modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="sp-modal__body">
        <h2 id={titleId} className="sp-modal__title">
          {title}
        </h2>
        {children}
        {actions && <div className="sp-modal__actions">{actions}</div>}
      </div>
    </dialog>
  )
}
