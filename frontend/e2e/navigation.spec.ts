import { expect, test } from '@playwright/test'

test('главная страница открывается', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('main')).toBeAttached()
})

test('экран подключения появляется по частям и учитывает уменьшение движения', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/connect')

  const header = page.locator('main > header')
  const intro = page.getByRole('region', { name: 'Поделили и рассчитались' })
  const wallets = page.locator('main .sp-row')
  await expect(header).toHaveCSS('animation-duration', '0.32s')
  await expect(intro).toHaveCSS('animation-duration', '0.32s')
  await expect(intro).toHaveCSS('animation-delay', '0.04s')
  await expect(wallets.first()).toHaveCSS('animation-duration', '0.28s')
  await expect(wallets.first()).toHaveCSS('animation-delay', '0.14s')
  await expect(wallets.nth(1)).toHaveCSS('animation-delay', '0.165s')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(intro).toHaveCSS('animation-name', 'none')
  await expect(intro).toHaveCSS('opacity', '1')
  await expect(wallets.first()).toHaveCSS('animation-name', 'none')
})

test('неизвестный адрес показывает 404 и ведёт на главную', async ({ page }) => {
  await page.goto('/unknown-page')

  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()

  const homeLink = page.getByRole('link', { name: 'На главную' })
  await expect(homeLink).toHaveAttribute('href', '/')
  await homeLink.click()

  await expect(page).toHaveURL('/connect')
})
