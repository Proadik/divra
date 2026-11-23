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

  it('имя профиля сохраняется', async () => {
    localStorage.setItem('divra.mock-auth-session', '7xQpZkTn4yLm8wR2vB3c9dH5jK3kF2')
    const { user } = renderWithRouter(<SettingsPage />)

    const field = await screen.findByLabelText('Как тебя зовут')
    await user.type(field, 'Адиль')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByRole('button', { name: 'Сохранено' })).toBeDisabled()
    expect(localStorage.getItem('divra.mock-profile-name')).toBe('Адиль')
  })
})
