import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { allNotes, api, noteContent, shot, tiles } from './helpers'

/**
 * Books plugin walkthrough: Books folder → Bookshelf → import an EPUB and a PDF → shelf cards, sort / filter /
 * search → EPUB reader (page turn, reload restores the position, quote into the book's note) → PDF reader
 * (page label, contents jump, Visual Options) → rename → remove. Fixtures live in e2e/fixtures/books (see make-epub.ts,
 * make-pdf.ts). The v2 reading experience (Paper, layouts, highlights, links) is covered by books-reading.spec.ts.
 */
test.describe.configure({ mode: 'serial' })

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/books')
const EPUB_FILE = { name: 'sample.epub', mimeType: 'application/epub+zip', buffer: readFileSync(path.join(FIXTURES, 'sample.epub')) }
const PDF_FILE = { name: 'sample.pdf', mimeType: 'application/pdf', buffer: readFileSync(path.join(FIXTURES, 'sample.pdf')) }

const shelf = (page: Page) => page.locator('section[data-tile-kind="view"]')
const reader = (page: Page) => page.locator('section[data-tile-kind="plugin"]')
const cards = (page: Page) => shelf(page).locator('[data-book-id]')
const EPUB_CARD = 'The Velocity Sampler, Ada Reader'
const PDF_CARD = 'Velocity PDF Handbook, Lin Pages'
const LOAD = { timeout: 30_000 }
const drawer = (page: Page) => reader(page).locator('aside')

/** The reader's status line: chapter (left), page (centre; hidden in a narrow tile but always in the DOM), percent (right). */
async function status(page: Page) {
  const spans = reader(page).locator('footer span')
  const text = async (i: number) => ((await spans.nth(i).textContent()) ?? '').trim()
  return { chapter: await text(0), page: await text(1), percent: await text(2) }
}
const statusKey = async (page: Page) => JSON.stringify(await status(page))

/** The reader hides its top bar and status line after 3 s; a pointer near the top edge brings them back. */
async function chromeUp(page: Page) {
  const box = (await reader(page).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 70, { steps: 3 })
  await page.mouse.move(box.x + box.width / 2 + 4, box.y + 60, { steps: 3 })
  await expect(reader(page).locator('header[inert]')).toHaveCount(0)
}

/** The reader takes the keyboard (arrows, B, H) without clicking into the page. */
const focusReader = (page: Page) => reader(page).locator('footer').locator('xpath=..').focus()

interface ApiBook {
  id: number
  title: string
  author: string | null
  format: 'epub' | 'pdf'
}

async function openShelf(page: Page) {
  if (await shelf(page).count()) return
  await page.keyboard.press('Control+Alt+KeyO')
  await expect(shelf(page)).toBeVisible()
}

/** Close every reader tile so the next book opens into a fresh one. */
async function closeReaders(page: Page) {
  while (await reader(page).count()) {
    await reader(page).first().getByRole('button', { name: /Close/ }).click()
    await page.waitForTimeout(300)
  }
}

async function openBook(page: Page, card: string) {
  await openShelf(page)
  await shelf(page).getByRole('listitem', { name: card }).click()
  await expect(reader(page)).toBeVisible()
}

test('Books folder, Bookshelf and importing an EPUB and a PDF', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()

  // 1. The Books folder exists and offers the Bookshelf.
  const folder = page.getByRole('button', { name: /^Books/ }).first()
  await expect(folder).toBeVisible({ timeout: 15_000 })
  await folder.click()
  await page.getByRole('button', { name: /Bookshelf/ }).first().click()
  await expect(shelf(page)).toBeVisible()
  await expect(shelf(page).getByText('Your bookshelf is empty')).toBeVisible()

  // 2. Add both books through the (hidden) file input.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    shelf(page).getByRole('button', { name: /Add Books/ }).first().click(),
  ])
  await chooser.setFiles([EPUB_FILE, PDF_FILE])

  // Cards carry the title and author read from the files, not the file names.
  await expect(shelf(page).getByRole('listitem', { name: EPUB_CARD })).toBeVisible(LOAD)
  await expect(shelf(page).getByRole('listitem', { name: PDF_CARD })).toBeVisible(LOAD)
  await expect(cards(page)).toHaveCount(2)
  await expect(shelf(page).getByText('2 books')).toBeVisible()
  await shot(page, 'books-shelf')

  const books = await api<ApiBook[]>('GET', '/api/plugins/books')
  expect(books.map((b) => [b.title, b.author, b.format]).sort()).toEqual([
    ['The Velocity Sampler', 'Ada Reader', 'epub'],
    ['Velocity PDF Handbook', 'Lin Pages', 'pdf'],
  ])

  // 3. Every book has a note in the Books folder, badged in the notes list.
  const notes = await allNotes()
  expect(notes.filter((n) => n.title === 'The Velocity Sampler' || n.title === 'Velocity PDF Handbook')).toHaveLength(2)
  await expect(page.locator('[data-note-row]').filter({ hasText: 'The Velocity Sampler' }).getByText('EPUB', { exact: true })).toBeVisible()

  // 4. The same file again is not added twice.
  const [again] = await Promise.all([
    page.waitForEvent('filechooser'),
    shelf(page).getByRole('button', { name: /Add Books/ }).first().click(),
  ])
  await again.setFiles([EPUB_FILE])
  await expect(shelf(page).locator('[data-upload]')).toHaveCount(0)
  await expect(cards(page)).toHaveCount(2)
})

test('sort, filter and search the shelf', async ({ page }) => {
  await page.goto('/')
  await openShelf(page)
  await expect(cards(page)).toHaveCount(2)

  await shelf(page).getByRole('button', { name: /Sort/ }).click()
  await page.getByRole('menuitem', { name: 'Title' }).click()
  await expect(cards(page).first()).toHaveAttribute('aria-label', EPUB_CARD)

  await shelf(page).getByRole('button', { name: /Filter/ }).click()
  await page.getByRole('menuitem', { name: 'PDF' }).click()
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page).first()).toHaveAttribute('aria-label', PDF_CARD)
  await expect(shelf(page).getByText('1 of 2 books')).toBeVisible()
  await shelf(page).getByRole('button', { name: /Filter/ }).click()
  await page.getByRole('menuitem', { name: 'All formats' }).click()
  await expect(cards(page)).toHaveCount(2)

  const search = shelf(page).getByLabel('Search books')
  await search.fill('ada')
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page).first()).toHaveAttribute('aria-label', EPUB_CARD)
  await search.fill('zzzz')
  await expect(cards(page)).toHaveCount(0)
  await search.fill('')
  await expect(cards(page)).toHaveCount(2)
})

test('read the EPUB: page turn, resume after reload, quote into the note', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await openBook(page, EPUB_CARD)
  await expect(reader(page).locator('iframe').first()).toBeVisible(LOAD)
  // The tile header names the book; the reader's own top bar shows the chapter.
  await expect(reader(page).locator('header').first()).toContainText('The Velocity Sampler')
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe('Chapter 1: Departure')
  // The book's scripts never run: the iframe stays sandboxed without allow-scripts.
  expect(await reader(page).locator('iframe').first().getAttribute('sandbox')).not.toContain('allow-scripts')

  // A page turn (key) changes the status line.
  await focusReader(page)
  const before = await statusKey(page)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => statusKey(page)).not.toBe(before)
  const turned = await statusKey(page)
  await shot(page, 'books-epub-reader')

  // Contents jump.
  await chromeUp(page)
  await reader(page).getByRole('button', { name: 'Contents' }).click()
  await expect(drawer(page)).toContainText('Chapter 3: Arrival')
  await drawer(page).getByText('Chapter 2: Momentum').click()
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe('Chapter 2: Momentum')

  // Reload: the Bookshelf and the Reader tiles come back and the reader resumes where it was.
  await focusReader(page)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => statusKey(page)).not.toBe(turned)
  // The position reaches the server shortly after the page turn (debounced), and is also kept locally.
  await expect
    .poll(async () => (await api<Array<ApiBook & { progress: number }>>('GET', '/api/plugins/books')).find((b) => b.format === 'epub')?.progress ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
  await page.reload()
  await expect(reader(page)).toBeVisible(LOAD)
  await expect(reader(page).locator('iframe').first()).toBeVisible(LOAD)
  // Same chapter again, not back at the start (the percentage can still settle once reading locations are ready).
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe('Chapter 2: Momentum')
  await expect(shelf(page)).toBeVisible()

  // Quote a passage into the book's note: the Notes menu opens the note beside the reader, the toolbar quotes.
  await chromeUp(page)
  await reader(page).getByRole('button', { name: 'Notes' }).click()
  await page.getByRole('menuitem', { name: 'Open Notes' }).click()
  const frame = reader(page).frameLocator('iframe').first()
  await frame.locator('p').nth(1).click({ clickCount: 3 })
  await reader(page).getByTestId('selection-toolbar').getByRole('button', { name: /Quote/ }).click()
  const note = (await allNotes()).find((n) => n.title === 'The Velocity Sampler')!
  expect(note).toBeTruthy()
  await expect.poll(async () => noteContent(note.id), { timeout: 15_000 }).toMatch(/\n> [^\n]+\n>\n> — \*Chapter \d: [A-Za-z]+\* · \d+%/)
  expect(await noteContent(note.id)).toMatch(/^<!-- velocity-book:\d+ -->/)
  await shot(page, 'books-epub-quote')
})

test('read the PDF: page label, contents jump, Visual Options', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await closeReaders(page)
  await openBook(page, PDF_CARD)
  await expect(reader(page).locator('canvas:visible').first()).toBeVisible(LOAD)
  await expect.poll(async () => (await status(page)).page, LOAD).toBe('p. 1 of 12')

  await chromeUp(page)
  await reader(page).getByRole('button', { name: 'Contents' }).click()
  await expect(drawer(page)).toContainText('Part II: Practice')
  await drawer(page).getByText('Part III: Mastery').click()
  await expect.poll(async () => (await status(page)).page, LOAD).toBe('p. 9 of 12')
  await shot(page, 'books-pdf-reader')

  // Dark reader theme through Visual Options (the page never stays white).
  await chromeUp(page)
  await reader(page).getByRole('button', { name: 'Visual Options' }).click()
  const pop = reader(page).getByRole('dialog', { name: 'Visual Options' })
  await pop.getByRole('radio', { name: /Dark$/ }).click()
  await expect(pop.getByRole('radio', { name: /Dark$/ })).toHaveAttribute('aria-checked', 'true')
})

test('shortcuts, rename and remove', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await closeReaders(page)
  await expect(tiles(page).first()).toBeVisible()
  if (await shelf(page).count()) {
    await shelf(page).getByRole('button', { name: /Close/ }).click()
    await expect(shelf(page)).toHaveCount(0)
  }
  await page.keyboard.press('Control+Alt+KeyO')
  await expect(shelf(page)).toBeVisible()
  await expect(cards(page)).toHaveCount(2)

  // Rename (the book's note follows).
  await shelf(page).getByRole('listitem', { name: PDF_CARD }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Rename/ }).click()
  const prompt = page.getByRole('dialog', { name: 'Rename book' })
  await prompt.locator('input').fill('Handbook <b>Renamed</b>')
  await page.keyboard.press('Enter')
  const renamed = shelf(page).getByRole('listitem', { name: /Handbook <b>Renamed<\/b>/ })
  await expect(renamed).toBeVisible()
  await expect.poll(async () => (await allNotes()).some((n) => n.title === 'Handbook <b>Renamed</b>')).toBe(true)

  // Remove with a destructive confirm: the book, its file and its note go.
  await renamed.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Remove from Library/ }).click()
  await expect(page.getByText(/The book file, its note and its highlights are deleted/)).toBeVisible()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(cards(page)).toHaveCount(1)
  await expect.poll(async () => (await api<ApiBook[]>('GET', '/api/plugins/books')).length).toBe(1)
  await expect.poll(async () => (await allNotes()).some((n) => n.title === 'Handbook <b>Renamed</b>')).toBe(false)

  // Ctrl+Alt+Shift+O opens the file picker.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+Alt+Shift+KeyO')])
  expect(chooser.isMultiple()).toBe(true)
})
