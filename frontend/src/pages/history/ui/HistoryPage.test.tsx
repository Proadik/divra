import { HistoryPage } from './HistoryPage'
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

describe('HistoryPage', () => {
  beforeEach(() => {
    localStorage.clear()
    enableDemoData()
  })

  it('листает страницами до конца, без повторов', async () => {
    const { user } = renderWithRouter(<HistoryPage />)

    const list = (): HTMLElement => screen.getByText('Переводы USDC', { exact: false })
    expect(list()).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/^(От|Кому):/)).toHaveLength(20))

    await user.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(await screen.findByText('Это все переводы')).toBeInTheDocument()
    const rows = screen.getAllByText(/^(От|Кому):/)
    expect(rows).toHaveLength(40)
    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(new Set(links).size).toBe(links.length)
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
  })

  it('засчитанный перевод показывает группу', async () => {
    renderWithRouter(<HistoryPage />)

    const [row] = await screen.findAllByText(/засчитано в «Ужин в пятницу»/)
    expect(row).toBeInTheDocument()
    expect(
      within(row?.closest('.history-row') as HTMLElement).getByText(/^От:/),
    ).toBeInTheDocument()
  })
})
