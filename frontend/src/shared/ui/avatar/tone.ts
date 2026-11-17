export type AvatarTone = 1 | 2 | 3 | 4

/** Стабильный тинт по id участника, чтобы цвет не прыгал между экранами. */
export const toneFor = (id: string): AvatarTone => {
  let hash = 0
  for (const ch of id) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  }
  return ((hash % 4) + 1) as AvatarTone
}
