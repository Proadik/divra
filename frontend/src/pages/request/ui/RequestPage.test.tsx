import { RequestPage } from './RequestPage'
import { usePreferences } from '@/entities/currency'
import { useWalletSession } from '@/entities/wallet'
import { createPaymentRequests } from '@/shared/api'
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

describe('RequestPage', () => {
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

  it('создаёт ссылки Solana Pay на каждого должника', async () => {
    const { user } = renderWithRouter(<RequestPage />, {
      route: '/groups/burabay/request',
      path: '/groups/:groupId/request',
    })

    await user.click(await screen.findByRole('button', { name: 'Создать запрос · 60.70 USDC' }))

    expect(await screen.findByRole('heading', { name: 'Запрос создан' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Тимур · 32.00' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      screen.getByRole('img', { name: /QR Solana Pay: Тимур платит 32.00 USDC/ }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Айгерим · 28.70' }))
    expect(screen.getByText('Айгерим платит 28.70 USDC')).toBeInTheDocument()
  })

  it('отправленные запросы: ждущий оплаты открывается заново — та же ссылка и QR', async () => {
    const [sent] = await createPaymentRequests('burabay', {
      token: 'USDC',
      recipient: '7xQpZkTn4yLm8wR2vB3c9dH5jK3kF2',
      memberIds: ['timur'],
      message: '',
      remindInDays: null,
    })
    const { user } = renderWithRouter(<RequestPage />, {
      route: '/groups/burabay/request',
      path: '/groups/:groupId/request',
    })

    expect(await screen.findByRole('heading', { name: 'Отправленные' })).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /Тимур.*ждёт оплаты/ })
    await user.click(row)

    expect(
      screen.getByRole('img', { name: /QR Solana Pay: Тимур платит 32.00 USDC/ }),
    ).toBeInTheDocument()
    expect(screen.getByText(`/r/${sent?.code ?? '—'}`, { exact: false })).toBeInTheDocument()
  })
})
