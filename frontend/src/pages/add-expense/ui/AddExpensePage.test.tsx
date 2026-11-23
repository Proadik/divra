import { AddExpensePage } from './AddExpensePage'
import { usePreferences } from '@/entities/currency'
import { getGroupOverview } from '@/shared/api'
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

const renderPage = (): ReturnType<typeof renderWithRouter> =>
  renderWithRouter(<AddExpensePage />, {
    route: '/groups/burabay/expenses/new',
    path: '/groups/:groupId/expenses/new',
  })

describe('AddExpensePage', () => {
  beforeEach(() => {
    enableDemoData()
    usePreferences.setState({ inputCurrency: 'KZT', stablecoin: 'USDC' })
  })

  it('делит поровну между всеми и включает кнопку после ввода суммы и названия', async () => {
    const { user } = renderPage()

    const save = screen.getByRole('button', { name: 'Сохранить расход' })
    expect(save).toBeDisabled()

    await screen.findByRole('option', { name: 'Тимур' })
    await user.type(screen.getByPlaceholderText('0'), '120')
    await user.type(screen.getByPlaceholderText('Например, ужин у костра'), 'Ужин')

    // Тенге — без копеек
    expect(screen.getAllByText('30 ₸')).toHaveLength(4)
    expect(screen.getByText('Сумма распределена полностью')).toBeInTheDocument()
    expect(save).toBeEnabled()
  })

  it('сумма в тенге показывает эквивалент в стейблкоине по курсу', async () => {
    const { user } = renderPage()

    expect(screen.getByRole('combobox', { name: 'Валюта суммы' })).toHaveValue('KZT')
    await user.type(screen.getByPlaceholderText('0'), '5154')

    // 5154 ₸ / 515.40 = 10 USD = 10 USDC
    expect(await screen.findByText('≈ 10.00 USDC · 1 USD = 515.40 ₸')).toBeInTheDocument()
  })

  it('валюту можно сменить для одного расхода, эквивалент — в выбранном стейблкоине', async () => {
    usePreferences.setState({ stablecoin: 'USDT' })
    const { user } = renderPage()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Валюта суммы' }), 'USD')
    await user.type(screen.getByPlaceholderText('0.00'), '12.5')

    expect(screen.getByText('≈ 12.50 USDT · 1 USD = 1 USDT')).toBeInTheDocument()
    expect(usePreferences.getState().inputCurrency).toBe('KZT')
  })

  it('рубль: без копеек, эквивалент по курсу RUB', async () => {
    usePreferences.setState({ inputCurrency: 'RUB' })
    const { user } = renderPage()

    await user.type(screen.getByPlaceholderText('0'), '812')

    expect(await screen.findByText('≈ 10.00 USDC · 1 USD = 81.20 ₽')).toBeInTheDocument()
  })

  describe('правка', () => {
    const renderEdit = (expenseId: string): ReturnType<typeof renderWithRouter> =>
      renderWithRouter(<AddExpensePage />, {
        route: `/groups/burabay/expenses/${expenseId}/edit`,
        path: '/groups/:groupId/expenses/:expenseId/edit',
      })

    it('открывает свой расход заполненным и сохраняет изменения', async () => {
      const { user } = renderEdit('e3')

      const title = await screen.findByDisplayValue('Домик у озера')
      expect(screen.getByRole('heading', { name: 'Правка расхода' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Валюта суммы' })).toHaveValue('USD')
      expect(screen.getByText('Сумма распределена полностью')).toBeInTheDocument()

      await user.clear(title)
      await user.type(title, 'Домик и баня')
      await user.click(screen.getByRole('button', { name: 'Сохранить изменения' }))

      await expect
        .poll(async () => (await getGroupOverview('burabay')).expenses.map((item) => item.title))
        .toContain('Домик и баня')
    })

    it('удаляет расход после подтверждения', async () => {
      const { user } = renderEdit('e6')
      await screen.findByDisplayValue('Прокат лодки')

      await user.click(screen.getByRole('button', { name: 'Удалить расход' }))
      await user.click(await screen.findByRole('button', { name: 'Удалить' }))

      await expect
        .poll(async () => (await getGroupOverview('burabay')).expenses.map((item) => item.id))
        .not.toContain('e6')
    })

    it('чужой расход (не автор и не плательщик) не открывается для правки', async () => {
      renderEdit('e1')

      expect(
        await screen.findByText(
          'Править расход может только тот, кто его записал, или тот, кто платил',
        ),
      ).toBeInTheDocument()
    })
  })
})
