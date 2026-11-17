import { PayRequestPage } from './PayRequestPage'
import { createPaymentRequests } from '@/shared/api'
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('PayRequestPage', () => {
  it('без расширения кошелька — ссылка Solana Pay для кошелька на телефоне', async () => {
    enableDemoData()
    localStorage.removeItem('divra.mock-db')
    const [request] = await createPaymentRequests('burabay', {
      token: 'USDC',
      recipient: '7xQpZkTn4yLm8wR2vB3c9dH5jK3kF2',
      memberIds: ['timur'],
      message: 'За бензин',
      remindInDays: null,
    })
    if (!request) {
      throw new Error('запрос не создан')
    }
    // Друг: другой браузер, своей базы нет — данные берутся из кода ссылки
    localStorage.clear()

    renderWithRouter(<PayRequestPage />, { route: `/r/${request.code}`, path: '/r/:code' })

    expect(await screen.findByText('Адиль просит перевести')).toBeInTheDocument()
    expect(screen.getByText('За бензин')).toBeInTheDocument()
    const pay = screen.getByRole('link', { name: /Открыть в кошельке · 32.00 USDC/ })
    expect(pay.getAttribute('href')).toMatch(
      /^solana:7xQpZkTn4yLm8wR2vB3c9dH5jK3kF2\?amount=32\.00&spl-token=/,
    )
  })

  it('битая ссылка — понятная ошибка', async () => {
    renderWithRouter(<PayRequestPage />, { route: '/r/broken-code', path: '/r/:code' })

    expect(await screen.findByRole('heading', { name: 'Запрос не работает' })).toBeInTheDocument()
  })
})
