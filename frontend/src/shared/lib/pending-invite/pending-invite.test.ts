import { clearPendingInvite, getPendingInvite, setPendingInvite } from './pending-invite'
import { afterEach, describe, expect, it } from 'vitest'

describe('pending invite', () => {
  afterEach(() => clearPendingInvite())

  it('хранит корректный код до очистки', () => {
    setPendingInvite('Abc_123-xyz')
    expect(getPendingInvite()).toBe('Abc_123-xyz')
    clearPendingInvite()
    expect(getPendingInvite()).toBeNull()
  })

  it('игнорирует мусор в storage', () => {
    sessionStorage.setItem('divra.pending-invite', '../../evil')
    expect(getPendingInvite()).toBeNull()
  })
})
