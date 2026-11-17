import { MembersPage } from './MembersPage'
import { enableDemoData, renderWithRouter } from '@/shared/lib/test'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

describe('MembersPage', () => {
  beforeEach(() => {
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
})
