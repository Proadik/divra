import { HomePage } from './HomePage'
import { usePreferences } from '@/entities/currency'
import { useWalletSession } from '@/entities/wallet'
import { useFeatureFlagsStore } from '@/shared/lib/feature-flags'
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

describe('HomePage', () => {
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

  it('показывает итог по всем группам и список групп с балансом в каждой', async () => {
    renderWithRouter(<HomePage />)

    expect(await screen.findByText('Итого по всем группам')).toBeInTheDocument()
    // 60.70 тебе должны, 37.50 должен ты
    expect(screen.getByText('+23.20')).toBeInTheDocument()
    expect(screen.getByText('60.70 USDC')).toBeInTheDocument()
    expect(screen.getByText('37.50 USDC')).toBeInTheDocument()

    const trip = screen.getByRole('button', { name: /^Алматы → Бурабай/ })
    expect(within(trip).getByText('+48.20')).toBeInTheDocument()
    const flat = screen.getByRole('button', { name: /^Квартира на Абая/ })
    expect(within(flat).getByText('−25.00')).toBeInTheDocument()
    expect(
      within(screen.getByRole('button', { name: /^Ужин в пятницу/ })).getByText('рассчитались'),
    ).toBeInTheDocument()
  })

  it('«Добавить расход» спрашивает, в какую группу', async () => {
    const { user } = renderWithRouter(<HomePage />)

    await user.click(await screen.findByRole('button', { name: /Добавить расход/ }))

    const dialog = screen.getByRole('dialog', { name: 'В какую группу?' })
    expect(within(dialog).getByRole('button', { name: /Квартира на Абая/ })).toBeInTheDocument()
  })

  it('новая группа: пустое название не отправляется', async () => {
    const { user } = renderWithRouter(<HomePage />)

    await user.click(await screen.findByRole('button', { name: 'Новая' }))
    const dialog = screen.getByRole('dialog', { name: 'Новая группа' })
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Назови группу')
  })

  it('суммы на главной — в выбранной валюте, с символом', async () => {
    usePreferences.setState({ amountsIn: 'fiat' })
    renderWithRouter(<HomePage />)

    // 23.20 × 515.40 = 11 957.28 → тенге без копеек
    expect(await screen.findByText('+11 957')).toBeInTheDocument()
    const trip = screen.getByRole('button', { name: /^Алматы → Бурабай/ })
    expect(within(trip).getByText('₸')).toBeInTheDocument()
  })

  it('без демо-данных — пустая главная нового пользователя', async () => {
    useFeatureFlagsStore.setState({ values: {} })
    renderWithRouter(<HomePage />)

    expect(
      await screen.findByText('Пока ни одной группы. Создай первую и позови друзей по ссылке.'),
    ).toBeInTheDocument()
    expect(screen.getByText('0.00')).toBeInTheDocument()
    expect(screen.getByText('Со всеми в расчёте')).toBeInTheDocument()
    expect(screen.queryByText('Недавнее')).not.toBeInTheDocument()
  })

  it('«История»: последние 5 переводов в сети и кнопка «Все»', async () => {
    renderWithRouter(<HomePage />)

    const section = (await screen.findByRole('heading', { name: 'История' })).closest('section')
    expect(section).not.toBeNull()
    await waitFor(() =>
      expect(within(section as HTMLElement).getAllByText(/^(От|Кому):/)).toHaveLength(5),
    )
    expect(within(section as HTMLElement).getByRole('button', { name: 'Все' })).toBeInTheDocument()
  })
})
