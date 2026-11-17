import { type ReactElement, useMemo } from 'react'
import { encode } from 'uqr'
import './qr-code.css'

export type QrCodeProps = {
  value: string
  /** Сторона в px */
  size?: number
  /** Что зашифровано — для скринридеров */
  label: string
}

/** QR-код в SVG. Модули рисуются прямоугольниками, без innerHTML. */
export const QrCode = ({ value, size = 168, label }: QrCodeProps): ReactElement => {
  const { data, size: modules } = useMemo(() => encode(value, { ecc: 'M', border: 0 }), [value])
  const path = useMemo(
    () => data.flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : ''))).join(''),
    [data],
  )
  return (
    <svg
      className="sp-qr"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="currentColor" />
    </svg>
  )
}
