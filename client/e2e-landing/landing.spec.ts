import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'https://github.com/Abhishek-03113/Velocity'
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots/landing')

/** Console errors that are not failed media requests (clips and stills may not exist yet). */
function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text())
  })
  return errors
}

async function settle(page: Page) {
  // Scroll the whole page once so reveal-on-scroll items and lazy media are in their final state.
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight
    for (let y = 0; y < h; y += 500) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 60))
    }
    window.scrollTo(0, 0)
  })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.waitForTimeout(900)
}

async function shot(page: Page, name: string, selector?: string) {
  mkdirSync(SHOTS, { recursive: true })
  const file = path.join(SHOTS, `${name}.png`)
  if (selector) {
    const el = page.locator(selector).first()
    await el.scrollIntoViewIfNeeded()
    await page.waitForTimeout(1200)
    // Hide fixed chrome in the capture only; the real page keeps nav, credit strip and skip link.
    const hide = await page.addStyleTag({ content: '.nav,.credit,.skip-link,.nav__sheet{visibility:hidden!important}' })
    await el.screenshot({ path: file })
    await hide.evaluate((n) => n.remove())
  } else {
    await page.screenshot({ path: file })
  }
}

test.describe('landing page', () => {
  test('loads cleanly with all landmarks', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/')
    await expect(page.locator('h1')).toHaveAttribute('aria-label', /Think at the speed of your keys/)
    await expect(page.locator('header.nav')).toBeVisible()
    await expect(page.locator('main#main')).toBeAttached()
    await expect(page.locator('footer.footer')).toBeAttached()
    for (const id of ['features', 'workspace', 'workflow', 'themes', 'reliability', 'technology', 'get']) {
      await expect(page.locator(`#${id}`)).toBeAttached()
    }
    await settle(page)
    expect(errors).toEqual([])
  })

  test('every CTA points at the GitHub repo', async ({ page }) => {
    await page.goto('/')
    const ctas = page.locator('a[data-cta]')
    expect(await ctas.count()).toBeGreaterThanOrEqual(5)
    for (const href of await ctas.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href))) {
      expect(href).toBe(REPO)
    }
  })

  test('credit footer: content, links, pinned 40px strip', async ({ page }) => {
    await page.goto('/')
    const credit = page.locator('.credit')
    await expect(credit).toContainText(`${new Date().getFullYear()}`)
    await expect(credit).toContainText('created by')
    await expect(credit).toContainText('with ❤️')
    await expect(credit.locator('a', { hasText: 'AP3X' })).toHaveAttribute('href', 'https://abhishek-3113.vercel.app/')
    const gh = credit.locator('a[aria-label="GitHub"]')
    await expect(gh).toHaveAttribute('href', 'https://github.com/Abhishek-03113')
    await expect(gh.locator('svg')).toHaveAttribute('viewBox', '0 0 16 16')
    const box = await credit.boundingBox()
    expect(box?.height).toBe(40)
    const vh = page.viewportSize()!.height
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(vh)
    const style = await credit.evaluate((el) => {
      const s = getComputedStyle(el)
      return { pos: s.position, filter: s.backdropFilter || s.webkitBackdropFilter, size: s.fontSize }
    })
    expect(style.pos).toBe('fixed')
    expect(style.filter).toContain('blur(20px)')
    expect(style.size).toBe('13px')
    // body reserves the strip's height
    expect(await page.evaluate(() => getComputedStyle(document.body).paddingBottom)).toBe('40px')
    // stays pinned after scrolling
    await page.evaluate(() => window.scrollTo(0, 3000))
    const again = await credit.boundingBox()
    expect(Math.round((again?.y ?? 0) + (again?.height ?? 0))).toBe(vh)
  })

  test('defaults to Gruvbox Dark Hard and the toggle switches to Light Hard', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(await bg()).toBe('rgb(29, 32, 33)')
    await page.locator('#theme-toggle').click()
    expect(await bg()).toBe('rgb(249, 245, 215)')
    await page.reload()
    expect(await bg()).toBe('rgb(249, 245, 215)')
  })

  test('hero clip actually plays', async ({ page }) => {
    await page.goto('/')
    const v = page.locator('[data-media="hero"] video')
    await expect(v).toHaveCount(1)
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-media="hero"] video') as HTMLVideoElement | null
      return !!el && el.currentTime > 0.3 && !el.paused
    })
    await expect(v).toHaveAttribute('data-live', 'true')
  })

  test('keyboard section reacts to real key presses', async ({ page }) => {
    await page.goto('/')
    await page.locator('#try').scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)
    await page.keyboard.down('Control')
    await page.keyboard.down('Alt')
    await page.keyboard.press('Backslash')
    await expect(page.locator('#kb-name')).toHaveText('Split tile right')
    await expect(page.locator('.key[data-code="ControlLeft"].is-down')).toBeVisible()
    await page.keyboard.up('Alt')
    await page.keyboard.up('Control')
    await expect(page.locator('.key.is-down')).toHaveCount(0)
  })

  test('theme picker recolours the mock window', async ({ page }) => {
    await page.goto('/')
    await page.locator('#themer').scrollIntoViewIfNeeded()
    await expect(page.locator('#mock-title')).toHaveText('Gruvbox Hard · Dark')
    const bg = () => page.locator('#mockwin').evaluate((el) => getComputedStyle(el).getPropertyValue('--m-bg').trim())
    await page.getByRole('radio', { name: 'Nord' }).click()
    await expect(page.locator('#mock-title')).toContainText('Nord')
    const nordBg = await bg()
    await page.getByRole('radio', { name: 'Solarized' }).click()
    await expect(page.locator('#mock-title')).toContainText('Solarized')
    expect(await bg()).not.toBe(nordBg)
    await page.getByRole('radio', { name: 'Catppuccin' }).click()
    await page.getByRole('radio', { name: 'Dark' }).click()
    await page.getByRole('radio', { name: 'Macchiato' }).click()
    await expect(page.locator('#mock-title')).toContainText('Catppuccin Macchiato · Dark')
  })

  test('no horizontal scroll on a phone', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    const errors = watchErrors(page)
    await page.goto('http://127.0.0.1:' + (process.env.LANDING_PORT ?? 4174) + '/')
    await settle(page)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(over).toBeLessThanOrEqual(0)
    expect(errors).toEqual([])
    await ctx.close()
  })
})

test.describe('reduced motion', () => {
  test('shows posters, no videos, nothing hidden', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await settle(page)
    expect(await page.locator('video').count()).toBe(0)
    const hero = page.locator('[data-media="hero"] img')
    await expect(hero).toBeVisible()
    expect(await hero.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
    // reveal-on-scroll content is visible without animating
    expect(await page.locator('[data-reveal]:not(.in)').count()).toBe(0)
    await expect(page.locator('.hero__title .w > span').first()).toHaveCSS('opacity', '1')
  })
})

test.describe('review screenshots', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`desktop ${scheme}`, async ({ page }) => {
      await page.goto('/')
      if (scheme === 'light') await page.locator('#theme-toggle').click()
      await page.waitForTimeout(2200)
      await shot(page, `desktop-${scheme}-hero`)
      await settle(page)
      await page.evaluate(() => document.querySelectorAll('[data-reveal]').forEach((e) => e.classList.add('in')))
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: path.join(SHOTS, `desktop-${scheme}-full.png`), fullPage: true })
      {
        for (const [name, sel] of [
          ['section-keyboard', '#features'],
          ['section-try', '#try'],
          ['section-workspace', '#workspace'],
          ['section-workflow', '#workflow'],
          ['section-themes', '#themes'],
          ['section-reliability', '#reliability'],
          ['section-technology', '#technology'],
          ['section-cta', '#get'],
        ] as const) {
          await shot(page, scheme === 'light' ? `${name}-light` : name, sel)
        }
      }
    })
  }

  test('phone', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto('http://127.0.0.1:' + (process.env.LANDING_PORT ?? 4174) + '/')
    await page.waitForTimeout(2000)
    await shot(page, 'phone-hero')
    await settle(page)
    await page.screenshot({ path: path.join(SHOTS, 'phone-full.png'), fullPage: true })
    await ctx.close()
  })
})
