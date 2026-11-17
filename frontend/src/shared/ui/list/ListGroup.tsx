import type { ReactElement, ReactNode } from 'react'
import './list.css'

export type ListGroupProps = {
  title?: string
  /** Короткий комментарий справа от заголовка или <StatusPill /> */
  aside?: ReactNode
  children: ReactNode
}

export const ListGroup = ({ title, aside, children }: ListGroupProps): ReactElement => {
  return (
    <section className="sp-listgroup-wrap">
      {title && (
        <div className="sp-listgroup__head">
          <h2 className="sp-listgroup__title">{title}</h2>
          {aside && <div className="sp-listgroup__aside">{aside}</div>}
        </div>
      )}
      <div className="sp-listgroup">{children}</div>
    </section>
  )
}
