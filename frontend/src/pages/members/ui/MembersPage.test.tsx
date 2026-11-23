import { MembersPage } from './MembersPage'
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

describe('MembersPage', () => {
  beforeEach(() => {
    // Мок-база живёт в localStorage: каждый тест начинает с демо-данных
    localStorage.clear()
    enableDemoData()
  })

  it('добавляет участника по имени без кошелька', async () => {
    const { user } = renderWithRouter(<MembersPage />, {
      route: '/groups/burabay/members',
      path: '/groups/:groupId/members',
    })
    await screen.findByText('Тимур')

    await user.type(screen.getByPlaceholderText('Например, Ержан'), 'Ержан')
    await user.click(screen.getByRole('button', { name: 'Добавить в группу' }))

    expect(await screen.findByText('Ержан')).toBeInTheDocument()
    expect(screen.getByText('без кошелька')).toBeInTheDocument()
  })

  it('не даёт добавить пустое имя', async () => {
    const { user } = renderWithRouter(<MembersPage />, {
      route: '/groups/burabay/members',
      path: '/groups/:groupId/members',
    })
    await screen.findByText('Тимур')

    await user.click(screen.getByRole('button', { name: 'Добавить в группу' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Введи имя')
  })

  it('создаёт ссылку-приглашение', async () => {
    const { user } = renderWithRouter(<MembersPage />, {
      route: '/groups/burabay/members',
      path: '/groups/:groupId/members',
    })
    await screen.findByText('Тимур')

    await user.click(screen.getByRole('button', { name: 'Создать ссылку' }))

    const link = await screen.findByLabelText('Ссылка-приглашение')
    expect((link as HTMLInputElement).value).toMatch(/\/join\/[\w-]+$/)
  })

  const renderPage = (): ReturnType<typeof renderWithRouter> =>
    renderWithRouter(<MembersPage />, {
      route: '/groups/burabay/members',
      path: '/groups/:groupId/members',
    })

  it('удаляет участника без кошелька и без долгов', async () => {
    const { user } = renderPage()
    await screen.findByText('Тимур')
    await user.type(screen.getByPlaceholderText('Например, Ержан'), 'Ержан')
    await user.click(screen.getByRole('button', { name: 'Добавить в группу' }))
    await screen.findByText('Ержан')

    await user.click(screen.getByRole('button', { name: 'Удалить Ержан' }))
    await user.click(await screen.findByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(screen.queryByText('Ержан')).not.toBeInTheDocument())
  })

  it('выйти из группы с долгами нельзя — объясняем почему', async () => {
    const { user } = renderPage()
    await screen.findByText('Тимур')

    await user.click(screen.getByRole('button', { name: 'Выйти из группы' }))
    await user.click(await screen.findByRole('button', { name: 'Выйти' }))

    expect(await screen.findByText(/Сначала рассчитайтесь/)).toBeInTheDocument()
  })

  it('созданная ссылка видна в действующих и отзывается', async () => {
    const { user } = renderPage()
    await screen.findByText('Тимур')

    await user.click(screen.getByRole('button', { name: 'Создать ссылку' }))
    expect(await screen.findByText('Общая ссылка')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Отозвать' }))

    await waitFor(() => expect(screen.queryByText('Общая ссылка')).not.toBeInTheDocument(), {
      timeout: 3000,
    })
  })
})
