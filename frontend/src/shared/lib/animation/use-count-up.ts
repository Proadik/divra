import { useEffect, useRef, useState } from 'react'

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia !== 'function' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Быстро в начале, мягко в конце — цифры «докручиваются» до значения */
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3

const toCents = (value: number): number => Math.round(value * 100)

/**
 * Счётчик, который докручивается до target: при первом показе — от нуля,
 * при смене значения (валюта, новые данные) — от предыдущего.
 * С prefers-reduced-motion (и в тестах без matchMedia) сразу отдаёт target.
 */
export const useCountUp = (target: number, durationMs = 900): number => {
  // Настройка системы на время жизни компонента не меняется — читаем один раз
  const [animate] = useState(() => !prefersReducedMotion())
  const [shown, setShown] = useState(0)
  const shownRef = useRef(0)

  useEffect(() => {
    if (!animate) {
      return undefined
    }
    const fromCents = toCents(shownRef.current)
    const deltaCents = toCents(target) - fromCents
    if (deltaCents === 0) {
      return undefined
    }
    const start = performance.now()
    let frame = 0
    const tick = (now: number): void => {
      // Метка кадра бывает чуть раньше start — без нижней границы прогресс уходит в минус
      const progress = Math.min(1, Math.max(0, (now - start) / durationMs))
      // Считаем в центах: на экране не бывает «23.199999»
      const value = (fromCents + Math.round(deltaCents * easeOutCubic(progress))) / 100
      shownRef.current = value
      setShown(value)
      if (progress < 1) {
        frame = requestAnimationFrame(tick)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [animate, target, durationMs])

  return animate ? shown : target
}
