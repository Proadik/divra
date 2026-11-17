import { ConnectPage } from './ConnectPage'
import { renderWithRouter } from '@/shared/lib/test'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('ConnectPage', () => {
  it('показывает кошельки; без расширений предлагает установить', () => {
    renderWithRouter(<ConnectPage />)

    expect(screen.getByRole('heading', { name: 'Поделили и рассчитались' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Phantom/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Solflare/ })).toBeInTheDocument()
    expect(screen.getAllByText('Установить')).toHaveLength(2)
  })
})
