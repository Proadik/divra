import { NotFoundPage } from './NotFoundPage'
import { renderWithRouter } from '@/shared/lib/test'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('NotFoundPage', () => {
  it('показывает 404 и ссылку на главную', () => {
    renderWithRouter(<NotFoundPage />, { route: '/unknown' })

    expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/')
  })
})
