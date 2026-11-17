import { SettingsPage } from './SettingsPage'
import { usePreferences } from '@/entities/currency'
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

describe('SettingsPage', () => {
  beforeEach(() => {
    enableDemoData()
    usePreferences.setState({ inputCurrency: 'KZT', stablecoin: 'USDC' })
  })

  it('сохраняет валюту ввода и стейблкоин', async () => {
    const { user } = renderWithRouter(<SettingsPage />)

    await user.click(await screen.findByRole('radio', { name: /Рубль/ }))
    await user.click(screen.getByRole('radio', { name: 'USDT' }))

    expect(usePreferences.getState()).toMatchObject({ inputCurrency: 'RUB', stablecoin: 'USDT' })
    expect(await screen.findByText('515.40 ₸ = 1 USDT')).toBeInTheDocument()
  })

  it('показывает все валюты конфига с курсом к стейблкоину', async () => {
    renderWithRouter(<SettingsPage />)

    expect(await screen.findByText('81.20 ₽ = 1 USDC')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Тенге/ })).toBeChecked()
    expect(
      within(screen.getByRole('group', { name: 'Валюта ввода' })).getAllByRole('radio'),
    ).toHaveLength(3)
  })
})
