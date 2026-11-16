import { expect, test } from '@playwright/test'

test('главная страница открывается', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('main')).toBeAttached()
})

test('неизвестный адрес показывает 404 и ведёт на главную', async ({ page }) => {
  await page.goto('/unknown-page')

  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()

  await page.getByRole('link', { name: 'На главную' }).click()

  await expect(page).toHaveURL('/')
})
