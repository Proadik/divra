import { ServerEventsSync } from './ServerEventsSync'
import { usePreferences } from '@/entities/currency'
import { useWalletSession } from '@/entities/wallet'
import { HomePage } from '@/pages/home'
import { simulateDetectedTransfer } from '@/shared/api'
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

const renderHome = (): ReturnType<typeof renderWithRouter> =>
  renderWithRouter(
    <>
      <ServerEventsSync />
      <HomePage />
    </>,
  )

/** Мок шлёт те же события, что и бэкенд по WebSocket: экран обновляется без перезагрузки */
describe('События и переводы мимо Divra', () => {
  beforeEach(() => {
    enableDemoData()
    localStorage.clear()
    usePreferences.setState({ inputCurrency: 'KZT', stablecoin: 'USDC', amountsIn: 'stablecoin' })
    const store = useWalletSession.getState()
    store.reset()
    store.connected('solana:phantom', {
      chain: 'solana',
      address: '7xQpZkTn4yLm8wR2vB3c9dH5jK3kF2',
    })
    store.verified('token')
  })

  it('замеченный перевод появляется сам; «Засчитать» уменьшает долг', async () => {
    const { user } = renderHome()
    expect(await screen.findByText('60.70 USDC')).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()

    // «Сеть»: Тимур (должен 32) перевёл 16 USDC из кошелька
    await simulateDetectedTransfer()

    const card = await screen.findByRole('article', { name: 'Перевод от Тимур' })
    expect(card).toHaveTextContent('Тимур перевёл тебе 16.00 USDC')
    expect(card).toHaveTextContent('Засчитать в «Алматы → Бурабай»?')

    await user.click(screen.getByRole('button', { name: 'Засчитать' }))

    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(await screen.findByText('44.70 USDC')).toBeInTheDocument()
  })

  it('«Это не за долг» — подсказка пропадает, долг тот же', async () => {
    const { user } = renderHome()
    await screen.findByText('60.70 USDC')
    await simulateDetectedTransfer()
    await screen.findByRole('article', { name: 'Перевод от Тимур' })

    await user.click(screen.getByRole('button', { name: 'Это не за долг' }))

    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(screen.getByText('60.70 USDC')).toBeInTheDocument()
  })
})
