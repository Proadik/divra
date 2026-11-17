import { SettlePage } from './SettlePage'
import { usePreferences } from '@/entities/currency'
import { useWalletSession } from '@/entities/wallet'
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

const renderPage = (groupId: string): ReturnType<typeof renderWithRouter> =>
  renderWithRouter(<SettlePage />, {
    route: `/groups/${groupId}/settle`,
    path: '/groups/:groupId/settle',
  })

describe('SettlePage', () => {
  beforeEach(() => {
    enableDemoData()
    localStorage.removeItem('divra.mock-db')
    usePreferences.setState({ stablecoin: 'USDC' })
    const store = useWalletSession.getState()
    store.reset()
    store.connected('solana:phantom', {
      chain: 'solana',
      address: '7xQpZkTn4yLm8wR2vB3c9dH5jK3kF2',
    })
    store.verified('token')
  })

  it('показывает, кому ты должен, и считает итог по выбранным', async () => {
    const { user } = renderPage('abaya')

    expect(await screen.findByText('Дана')).toBeInTheDocument()
    expect(screen.getByText('Арман')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Подписать и отправить · 25.00 USDC' }),
    ).toBeEnabled()

    await user.click(screen.getByRole('checkbox', { name: 'Перевести Арман' }))
    expect(screen.getByRole('button', { name: 'Подписать и отправить · 15.00 USDC' })).toBeEnabled()
  })

  it('не даёт перевести больше долга и токеном, которого нет в сети', async () => {
    const { user } = renderPage('abaya')
    const amount = await screen.findByRole('textbox', { name: 'Сумма для Дана' })

    await user.clear(amount)
    await user.type(amount, '16')
    expect(screen.getByRole('alert')).toHaveTextContent('Сумма больше долга')

    await user.clear(amount)
    await user.type(amount, '15')
    await user.click(screen.getByRole('radio', { name: 'USDT' }))
    // Сборка для devnet: у Tether нет devnet-токена
    expect(await screen.findByRole('alert')).toHaveTextContent('USDT нет в этой сети Solana')
  })
})
