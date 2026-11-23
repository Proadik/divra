import { GroupPage } from './GroupPage'
import { usePreferences } from '@/entities/currency'
import { useWalletSession } from '@/entities/wallet'
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

describe('GroupPage', () => {
  beforeEach(() => {
    enableDemoData()
    const store = useWalletSession.getState()
    store.reset()
    store.connected('solana:phantom', {
      chain: 'solana',
      address: '7xQpZkTn4yLm8wR2vB3c9dH5jK3kF2',
    })
    store.verified('token')
    localStorage.removeItem('divra.mock-db')
    usePreferences.setState({ inputCurrency: 'KZT', stablecoin: 'USDC', amountsIn: 'stablecoin' })
  })

  it('показывает группу: баланс, кто кому, расходы и кнопку добавления', async () => {
    renderWithRouter(<GroupPage />, { route: '/groups/burabay', path: '/groups/:groupId' })

    expect(await screen.findByRole('heading', { name: 'Алматы → Бурабай' })).toBeInTheDocument()
    expect(screen.getByText('+48.20')).toBeInTheDocument()
    expect(screen.getByText('3 перевода вместо 7')).toBeInTheDocument()
    expect(screen.getByText('Бензин до Бурабая')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Добавить расход/ })).toBeInTheDocument()
  })

  it('переключает суммы группы в валюту пользователя по курсу', async () => {
    const { user } = renderWithRouter(<GroupPage />, {
      route: '/groups/burabay',
      path: '/groups/:groupId',
    })
    await screen.findByText('+48.20')

    await user.click(screen.getByRole('radio', { name: 'KZT ₸' }))

    // 48.20 × 515.40 = 24 842.28 → тенге без копеек
    expect(await screen.findByText('+24 842')).toBeInTheDocument()
    expect(screen.getAllByText('₸').length).toBeGreaterThan(1)
    expect(screen.getByText('≈ по курсу 1 USD = 515.40 ₸ · расчёт в USDC')).toBeInTheDocument()
    expect(usePreferences.getState().amountsIn).toBe('fiat')
  })

  it('возврат наличными: тот, кому должны, отмечает — долг уменьшается', async () => {
    const { user } = renderWithRouter(<GroupPage />, {
      route: '/groups/burabay',
      path: '/groups/:groupId',
    })
    await screen.findByText('+48.20')

    await user.click(screen.getByRole('button', { name: /Тимур.*вернёт тебе/ }))
    await user.type(await screen.findByLabelText('Сколько вернул, $'), '12')
    await user.click(screen.getByRole('button', { name: 'Отметить возврат' }))

    // Тимур был должен 32.00 → 20.00, баланс 48.20 → 36.20
    expect(await screen.findByText('+36.20')).toBeInTheDocument()
  })

  it('свой расход открывается для правки, чужой — нет', async () => {
    renderWithRouter(<GroupPage />, { route: '/groups/burabay', path: '/groups/:groupId' })
    await screen.findByText('+48.20')

    expect(screen.getByRole('button', { name: /Домик у озера/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Бензин до Бурабая/ })).not.toBeInTheDocument()
  })
})
