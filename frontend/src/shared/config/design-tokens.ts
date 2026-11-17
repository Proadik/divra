// Divra — дизайн-токены. Ссылки на CSS-переменные из tokens.css.
export const color = {
  surface: 'var(--surface)',
  'surface-raised': 'var(--surface-raised)',
  'surface-sunken': 'var(--surface-sunken)',
  'surface-inverse': 'var(--surface-inverse)',
  line: 'var(--line)',
  'line-strong': 'var(--line-strong)',
  'line-inverse': 'var(--line-inverse)',
  ink: 'var(--ink)',
  'ink-muted': 'var(--ink-muted)',
  'on-inverse': 'var(--on-inverse)',
  'on-inverse-muted': 'var(--on-inverse-muted)',
  accent: 'var(--accent)',
  'on-accent': 'var(--on-accent)',
  'accent-soft': 'var(--accent-soft)',
  owe: 'var(--owe)',
  'owe-soft': 'var(--owe-soft)',
  positive: 'var(--positive)',
  'positive-fill': 'var(--positive-fill)',
  danger: 'var(--danger)',
  'avatar-1': 'var(--avatar-1)',
  'avatar-2': 'var(--avatar-2)',
  'avatar-3': 'var(--avatar-3)',
  'avatar-4': 'var(--avatar-4)',
  focus: 'var(--focus)',
} as const

export const space = {
  'space-1': 'var(--space-1)',
  'space-2': 'var(--space-2)',
  'space-3': 'var(--space-3)',
  'space-4': 'var(--space-4)',
  'space-5': 'var(--space-5)',
  'space-6': 'var(--space-6)',
  'space-8': 'var(--space-8)',
} as const

export const radius = {
  'radius-sm': 'var(--radius-sm)',
  'radius-md': 'var(--radius-md)',
  'radius-lg': 'var(--radius-lg)',
  'radius-xl': 'var(--radius-xl)',
  'radius-2xl': 'var(--radius-2xl)',
  'radius-full': 'var(--radius-full)',
} as const

export const shadow = {
  'shadow-fab': 'var(--shadow-fab)',
  'shadow-segment': 'var(--shadow-segment)',
} as const

export const size = {
  'size-touch': 'var(--size-touch)',
  'size-control': 'var(--size-control)',
  'size-cta': 'var(--size-cta)',
  'size-row': 'var(--size-row)',
} as const

export const font = { sans: 'var(--font-sans)' } as const

export type ColorToken = keyof typeof color
export type SpaceToken = keyof typeof space
export type RadiusToken = keyof typeof radius
