import { base64ToBytes, bytesToBase64 } from './base64'
import { describe, expect, it } from 'vitest'

describe('base64', () => {
  it('кодирует и декодирует байты без потерь', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})
