import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { allNotes, noteContent, shot, tiles } from './helpers'

/**
 * LaTeX plugin walkthrough: new document → live preview tile → edit → compile to PDF →
 * TeX error with jump-to-line → .tex / PDF export → badge → layout restore.
 * The E2E server runs a stand-in pdflatex (e2e/fixtures/tex-bin), since CI has no TeX.
 */
test.describe.configure({ mode: 'serial' })

const previewTile = (page: Page) => page.locator('section[data-tile-kind="plugin"]')
const noteEditor = (page: Page) => page.locator('section[data-tile-kind="note"] .cm-content')

async function runCommand(page: Page, query: string, option: RegExp) {
  await page.keyboard.press('Control+Shift+KeyP')
  const cmd = page.getByRole('dialog', { name: 'Command palette' })
  await expect(cmd).toBeVisible()
  await page.keyboard.type(query)
  await cmd.getByRole('option', { name: option }).first().click()
  await expect(cmd).toHaveCount(0)
}

/** Put the cursor at the start of the `\end{document}` line (the template ends with it). */
async function beforeEndDocument(page: Page) {
  await noteEditor(page).click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Home')
}

test('write LaTeX with a live preview, compile it, export it', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)

  // 1. New document: the note opens with the preview tile beside it.
  await runCommand(page, 'new latex', /New LaTeX Document/)
  const preview = previewTile(page)
  await expect(preview.locator('.ltx-page h2').first()).toHaveText('1 Introduction', { timeout: 15_000 })
  await expect(tiles(page)).toHaveCount(2)
  await expect(preview.locator('header')).toContainText('LaTeX Preview')
  await expect(preview.locator('.ltx-page .katex').first()).toBeVisible()
  await expect(preview.locator('.ltx-page .katex-error')).toHaveCount(0)
  await expect(preview.locator('.ltx-page .ltx-ref').first()).toHaveText('1')
  // The source is edited as LaTeX, not rich Markdown.
  await expect(noteEditor(page).locator('.cm-line').first()).toHaveText('\\documentclass[11pt]{article}')
  await shot(page, 'latex-live-preview')

  // 2. The preview follows edits.
  await beforeEndDocument(page)
  await page.keyboard.insertText('\\section{Results}\nWe find $\\beta = \\frac{1}{2}$.\n\n')
  await expect(preview.locator('.ltx-page h2').last()).toHaveText('3 Results')

  // 3. Compile to PDF (headless Chromium has no PDF viewer, so the tile offers "Open PDF").
  await page.keyboard.press('Control+Alt+Shift+KeyX')
  await expect(preview.getByRole('radio', { name: 'PDF' })).toHaveAttribute('aria-checked', 'true')
  await expect(preview.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', /^blob:/, { timeout: 20_000 })
  await expect(preview.locator('[aria-live]')).toContainText('pdflatex')

  // 4. A TeX error: recompiles after a pause, lists the line, jumps to it.
  await beforeEndDocument(page)
  await page.keyboard.insertText('\\undefinedthing\n')
  const issue = preview.getByRole('button', { name: /Undefined control sequence/ })
  await expect(issue).toBeVisible({ timeout: 20_000 })
  await expect(preview.locator('[aria-live]')).toContainText('1 error')
  await shot(page, 'latex-tex-error')
  await issue.click()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('\\undefinedthing')
  await page.keyboard.press('Delete')
  await expect(issue).toHaveCount(0, { timeout: 20_000 })
  await expect(preview.locator('[aria-live]')).not.toContainText('error')

  // 5. Exports.
  const note = (await allNotes()).filter((n) => n.title === 'Untitled Document').sort((a, b) => b.id - a.id)[0]!
  expect(note).toBeTruthy()
  await expect.poll(async () => noteContent(note.id)).toContain('\\section{Results}')
  let download = page.waitForEvent('download')
  await runCommand(page, 'export as .tex', /LaTeX: Export as \.tex/)
  let file = await download
  expect(file.suggestedFilename()).toBe('Untitled-Document.tex')
  expect(readFileSync((await file.path())!, 'utf8')).toContain('\\section{Results}')

  download = page.waitForEvent('download', { predicate: (d) => d.suggestedFilename().endsWith('.pdf') })
  await runCommand(page, 'export as pdf', /LaTeX: Export as PDF/)
  file = await download
  expect(file.suggestedFilename()).toBe('Untitled-Document.pdf')
  expect(readFileSync((await file.path())!, 'utf8').startsWith('%PDF-')).toBe(true)

  // 6. LaTeX notes carry a TeX badge; the preview tile survives a reload.
  await expect(page.locator(`[data-note-row="${note.id}"][data-badge="TeX"]`)).toBeVisible()
  await page.waitForTimeout(500)
  await page.reload()
  await expect(previewTile(page).locator('.ltx-page h2').first()).toHaveText('1 Introduction', { timeout: 15_000 })

  // 7. Ctrl+Alt+X toggles the tile.
  await noteEditor(page).click()
  await page.keyboard.press('Control+Alt+KeyX')
  await expect(previewTile(page)).toHaveCount(0)
  await page.keyboard.press('Control+Alt+KeyX')
  await expect(previewTile(page).locator('.ltx-page')).toBeVisible()
})
