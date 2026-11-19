import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { allNotes, api, noteContent, shot, tiles } from './helpers'

/**
 * Books v2 reading experience (docs/specs/books-reading-experience.md): Paper theme, page turns (keys, tap zones),
 * Visual Options, layout switch that keeps the place, highlights (selection toolbar, note, delete), bookmarks, the
 * drawer, the highlights note with velocity:// links back into the book, exact reopen after a reload, the PDF reader,
 * and removing the books again (the next spec, books.spec.ts, starts from an empty shelf).
 */
test.describe.configure({ mode: 'serial' })

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/books')
const file = (name: string, mimeType: string) => ({ name, mimeType, buffer: readFileSync(path.join(FIXTURES, name)) })
const EPUB_FILE = file('sample.epub', 'application/epub+zip')
const LONG_FILE = file('long.epub', 'application/epub+zip')
const PDF_FILE = file('sample.pdf', 'application/pdf')

const SAMPLER = 'The Velocity Sampler, Ada Reader'
const LONG = 'The Long Crossing, Ada Reader'
const HANDBOOK = 'Velocity PDF Handbook, Lin Pages'
const LOAD = { timeout: 30_000 }
/** Something nasty that must stay inert wherever a note's text is shown. */
const NASTY = 'Mind </textarea><img src=x onerror=window.__pwn=1> [x](javascript:alert(1)) **bold**'

interface ApiBook {
  id: number
  title: string
  format: 'epub' | 'pdf'
  position: string | null
  progress: number
}
interface ApiAnnotation {
  id: number
  kind: 'highlight' | 'bookmark'
  locator: string
  text: string | null
  note: string | null
  color: string | null
  style: string | null
  page: number | null
}

const shelf = (page: Page) => page.locator('section[data-tile-kind="view"]')
const reader = (page: Page) => page.locator('section[data-tile-kind="plugin"]')
const cards = (page: Page) => shelf(page).locator('[data-book-id]')
const toolbar = (page: Page) => reader(page).getByTestId('selection-toolbar')
const drawer = (page: Page) => reader(page).locator('aside')
const options = (page: Page) => reader(page).getByRole('dialog', { name: 'Visual Options' })
const noteTileOf = (page: Page, title: string) => page.locator('section[data-tile-kind="note"]').filter({ hasText: title })
const epubFrame = (page: Page) => reader(page).frameLocator('iframe').first()

const books = () => api<ApiBook[]>('GET', '/api/plugins/books')
const bookByTitle = async (title: string) => (await books()).find((b) => b.title === title)!
const annotations = (id: number) => api<ApiAnnotation[]>('GET', `/api/plugins/books/${id}/annotations`)

/** The status line: chapter (left), page (centre, hidden in a narrow tile but always in the DOM) and percent (right). */
async function status(page: Page) {
  const spans = reader(page).locator('footer span')
  const text = async (i: number) => ((await spans.nth(i).textContent()) ?? '').trim()
  return { chapter: await text(0), page: await text(1), percent: Number.parseInt(await text(2), 10) }
}

async function openShelf(page: Page) {
  if (await shelf(page).count()) return
  await page.keyboard.press('Control+Alt+KeyO')
  await expect(shelf(page)).toBeVisible()
}

/** Open a book from the shelf, give its tile the whole workspace and wait for the first page. */
async function openBook(page: Page, card: string, kind: 'epub' | 'pdf' = 'epub') {
  await openShelf(page)
  await shelf(page).getByRole('listitem', { name: card }).click()
  await expect(reader(page)).toBeVisible()
  await expect(kind === 'epub' ? reader(page).locator('iframe').first() : reader(page).locator('canvas:visible').first()).toBeVisible(LOAD)
  await expect.poll(async () => (await status(page)).chapter, LOAD).not.toBe('')
  await page.keyboard.press('Control+Alt+Enter') // wide tile: two-page spread, page numbers, room for the toolbars
  await page.waitForTimeout(800)
}

/** The reader root takes the keyboard (B, H, arrows) without clicking into the page. */
const focusReader = (page: Page) => reader(page).locator('footer').locator('xpath=..').focus()

/** Bring the auto-hidden top bar and status line back (pointer near the top edge, as a reader would). */
async function chromeUp(page: Page) {
  const box = (await reader(page).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 70, { steps: 3 })
  await page.mouse.move(box.x + box.width / 2 + 4, box.y + 60, { steps: 3 })
  await expect(reader(page).locator('header[inert]')).toHaveCount(0)
}

async function tap(page: Page, fraction: number) {
  const box = (await reader(page).boundingBox())!
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height * 0.5)
}

/** The resolved Paper colour as RGB (a canvas turns oklab / color-mix into pixels). */
async function readerPaper(page: Page): Promise<number[]> {
  return reader(page)
    .locator('footer')
    .locator('xpath=..')
    .evaluate((root) => {
      const probe = document.createElement('div')
      probe.style.background = 'var(--reader-bg)'
      root.appendChild(probe)
      const colour = getComputedStyle(probe).backgroundColor
      probe.remove()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = colour
      ctx.fillRect(0, 0, 1, 1)
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3)
    })
}

async function openDrawer(page: Page, tab: RegExp) {
  await chromeUp(page)
  await reader(page).getByRole('button', { name: 'Contents' }).click()
  await expect(drawer(page)).toBeVisible()
  await drawer(page).getByRole('radio', { name: tab }).click()
}

async function closeDrawer(page: Page) {
  await drawer(page).getByRole('radio').first().focus() // Escape closes the drawer while focus is inside it
  await page.keyboard.press('Escape')
  await expect(drawer(page)).toHaveCount(0)
}

/** Jump to a contents entry by its label and wait for the status line to say so. */
async function jumpToChapter(page: Page, label: string) {
  await openDrawer(page, /^Contents$/)
  await drawer(page).locator('[data-nav]').filter({ hasText: label }).first().click()
  await expect(drawer(page)).toHaveCount(0)
  await expect.poll(async () => (await status(page)).chapter, LOAD).toContain(label)
}

/** Select a whole paragraph of the EPUB page; the toolbar floats up. */
async function selectParagraph(page: Page, n: number) {
  await epubFrame(page).locator('p').nth(n).click({ clickCount: 3 })
  await expect(toolbar(page)).toBeVisible()
}

const toolbarButton = (page: Page, name: string) => toolbar(page).getByRole('button', { name, exact: true })

async function writeNote(page: Page, text: string) {
  const sheet = reader(page).getByRole('dialog', { name: 'Note' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('textbox').fill(text)
  await page.keyboard.press('Control+Enter')
  await expect(sheet).toHaveCount(0)
}

async function closeReaders(page: Page) {
  while (await reader(page).count()) {
    await reader(page).first().getByRole('button', { name: /Close/ }).click()
    await page.waitForTimeout(300)
  }
}

async function showOptions(page: Page) {
  await chromeUp(page)
  await reader(page).getByRole('button', { name: 'Visual Options' }).click()
  await expect(options(page)).toBeVisible()
}

// Theme chips are named "Aa Dark" (swatch + label); the segmented controls carry just the label.
const choose = (page: Page, group: string, label: string) =>
  options(page)
    .getByRole('radiogroup', { name: group, exact: true })
    .getByRole('radio', group === 'Theme' ? { name: new RegExp(`${label}$`) } : { name: label, exact: true })

async function pick(page: Page, group: string, label: string) {
  await choose(page, group, label).click()
  await expect(choose(page, group, label)).toHaveAttribute('aria-checked', 'true')
}

test('import an EPUB, a long EPUB and a PDF', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await page.getByRole('button', { name: /^Books/ }).first().click()
  await page.getByRole('button', { name: /Bookshelf/ }).first().click()
  await expect(shelf(page)).toBeVisible()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    shelf(page).getByRole('button', { name: /Add Books/ }).first().click(),
  ])
  await chooser.setFiles([EPUB_FILE, LONG_FILE, PDF_FILE])
  for (const card of [SAMPLER, LONG, HANDBOOK]) await expect(shelf(page).getByRole('listitem', { name: card })).toBeVisible(LOAD)
  await expect(cards(page)).toHaveCount(3)
  expect((await books()).map((b) => b.title).sort()).toEqual(['The Long Crossing', 'The Velocity Sampler', 'Velocity PDF Handbook'])
})

test('EPUB: Paper, page turns by key and tap, no scripts', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await openBook(page, SAMPLER)

  // The book's scripts never run, also not in a page-turn snapshot.
  for (const sandbox of await reader(page).locator('iframe').evaluateAll((all) => all.map((f) => f.getAttribute('sandbox') ?? ''))) {
    expect(sandbox).not.toContain('allow-scripts')
  }

  // Paper is the default stock: a warm off-white, not white.
  const [r, g, b] = await readerPaper(page)
  expect(Math.max(r!, g!, b!)).toBeLessThan(255)
  expect(r!).toBeGreaterThan(b!)

  await expect.poll(async () => (await status(page)).chapter).toBe('Chapter 1: Departure')
  await focusReader(page)
  const first = await status(page)
  expect(first.page).toMatch(/^\d+ \/ \d+$/)

  // Keys, then the right tap zone, then the left one.
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await status(page)).page).not.toBe(first.page)
  const afterKey = await status(page)
  await tap(page, 0.92)
  await expect.poll(async () => JSON.stringify(await status(page))).not.toBe(JSON.stringify(afterKey))
  const afterTap = await status(page)
  await tap(page, 0.08)
  await expect.poll(async () => JSON.stringify(await status(page))).not.toBe(JSON.stringify(afterTap))

  // Home / End jump to the ends; the progress follows.
  await focusReader(page)
  await page.keyboard.press('End')
  await expect.poll(async () => (await status(page)).percent, LOAD).toBeGreaterThanOrEqual(80)
  await page.keyboard.press('Home')
  await expect.poll(async () => (await status(page)).percent, LOAD).toBeLessThan(10)

  // A tap in the middle toggles the chrome (the top bar is inert while hidden).
  await chromeUp(page)
  await tap(page, 0.5)
  await expect(reader(page).locator('header[inert]')).toHaveCount(1)
  await tap(page, 0.5)
  await expect(reader(page).locator('header[inert]')).toHaveCount(0)
  await shot(page, 'books-v2-paper')
})

test('Visual Options and the layout switch keep the place', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/')
  await openBook(page, LONG)
  await jumpToChapter(page, 'Chapter 10: Brackwater')
  await focusReader(page)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await status(page)).page).toMatch(/^3 \/ \d+$/)
  const here = await status(page)

  await showOptions(page)
  // Theme: the five stocks apply live, and the paper stays the default.
  await pick(page, 'Theme', 'Dark')
  const [dr, dg, db] = await readerPaper(page)
  expect(Math.max(dr!, dg!, db!)).toBeLessThan(110)
  for (const theme of ['Sepia', 'Light', 'Auto', 'Paper']) await pick(page, 'Theme', theme)

  // Pages → Scroll: continuous across chapters, same place.
  await pick(page, 'Layout', 'Scroll')
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe(here.chapter)
  await expect.poll(async () => Math.abs((await status(page)).percent - here.percent), LOAD).toBeLessThanOrEqual(2)
  await pick(page, 'Layout', 'Pages')
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe(here.chapter)
  await expect.poll(async () => Math.abs((await status(page)).percent - here.percent), LOAD).toBeLessThanOrEqual(2)

  // Page turn effects, type, spacing and margins never lose the chapter.
  for (const turn of ['Curl', 'Fade', 'None', 'Slide']) await pick(page, 'Page turn', turn)
  await pick(page, 'Font', 'Sans')
  await pick(page, 'Margins', 'Wide')
  await pick(page, 'Align', 'Justify')
  await options(page).getByRole('group', { name: 'Text size' }).getByRole('button', { name: /Increase/ }).click()
  await expect(options(page).getByRole('group', { name: 'Text size' })).toContainText('110%')
  await options(page).getByRole('group', { name: 'Line spacing' }).getByRole('button', { name: /Increase/ }).click()
  await options(page).getByRole('group', { name: 'Paragraph spacing' }).getByRole('button', { name: /Increase/ }).click()
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe(here.chapter)
  await shot(page, 'books-v2-visual-options')

  // Reset restores the defaults.
  await options(page).getByRole('button', { name: 'Reset' }).click()
  await expect(choose(page, 'Font', 'Serif')).toHaveAttribute('aria-checked', 'true')
  await expect(options(page).getByRole('group', { name: 'Text size' })).toContainText('100%')
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe(here.chapter)
})

test('EPUB highlights: toolbar, note, drawer, delete, bookmarks', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/')
  await openBook(page, SAMPLER)
  const id = (await bookByTitle('The Velocity Sampler')).id
  await focusReader(page)

  // A selection brings the toolbar; choosing a style and a colour creates the highlight at once.
  await selectParagraph(page, 0)
  await expect(toolbar(page)).toContainText('Copy')
  await toolbarButton(page, 'Highlight').click()
  await toolbarButton(page, 'Yellow').click()
  await expect.poll(async () => (await annotations(id)).length).toBe(1)
  expect((await annotations(id))[0]).toMatchObject({ kind: 'highlight', style: 'highlight', color: 'yellow' })

  // The other styles and colours (each on its own paragraph).
  const combos: Array<[string, string, string]> = [
    ['Underline', 'Green', 'underline'],
    ['Strikethrough', 'Blue', 'strike'],
    ['Squiggly underline', 'Pink', 'squiggle'],
  ]
  for (const [i, [style, colour]] of combos.entries()) {
    await page.keyboard.press('Escape')
    await selectParagraph(page, i + 1)
    await toolbarButton(page, style).click()
    await toolbarButton(page, colour).click()
    await expect.poll(async () => (await annotations(id)).length).toBe(i + 2)
  }
  expect((await annotations(id)).map((a) => `${a.style}:${a.color}`).sort()).toEqual([
    'highlight:yellow',
    'squiggle:pink',
    'strike:blue',
    'underline:green',
  ])
  await shot(page, 'books-v2-highlights')

  // A note on the last one; hostile text stays text.
  await toolbarButton(page, 'Note').click()
  await writeNote(page, NASTY)
  await expect.poll(async () => (await annotations(id)).filter((a) => a.note === NASTY).length).toBe(1)

  // The drawer lists them with the note, escaped.
  await openDrawer(page, /^Highlights/)
  await expect(drawer(page)).toContainText('The harbour woke slowly')
  await expect(drawer(page)).toContainText('</textarea>')
  await expect(drawer(page).locator('img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn)).toBeUndefined()
  await shot(page, 'books-v2-drawer')

  // Delete from the drawer's row menu ...
  await drawer(page).getByRole('button', { name: 'More actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect.poll(async () => (await annotations(id)).length).toBe(3)
  await closeDrawer(page)

  // ... and from the toolbar that opens when a highlight is tapped.
  const box = (await epubFrame(page).locator('p').nth(1).boundingBox())!
  await page.mouse.click(box.x + 60, box.y + 12)
  await expect(toolbar(page)).toBeVisible()
  await toolbarButton(page, 'Delete highlight').click()
  await expect.poll(async () => (await annotations(id)).length).toBe(2)

  // Bookmarks: B toggles, the ribbon button agrees, the drawer lists them.
  await focusReader(page)
  await page.keyboard.press('b')
  await expect.poll(async () => (await annotations(id)).filter((a) => a.kind === 'bookmark').length).toBe(1)
  await page.keyboard.press('b')
  await expect.poll(async () => (await annotations(id)).filter((a) => a.kind === 'bookmark').length).toBe(0)
  await chromeUp(page)
  await reader(page).getByRole('button', { name: 'Add Bookmark' }).click()
  await expect.poll(async () => (await annotations(id)).filter((a) => a.kind === 'bookmark').length).toBe(1)
  await expect(reader(page).getByRole('button', { name: 'Remove Bookmark' })).toBeVisible()
  await openDrawer(page, /^Bookmarks/)
  await expect(drawer(page)).toContainText('1 bookmark')
  await closeDrawer(page)
})

test('highlights note: links back to the place, reader open or closed', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await openBook(page, LONG)
  const book = await bookByTitle('The Long Crossing')
  await jumpToChapter(page, 'Chapter 20: Dunmarrow')
  await selectParagraph(page, 1)
  await toolbarButton(page, 'Highlight').click()
  await toolbarButton(page, 'Yellow').click()
  await expect.poll(async () => (await annotations(book.id)).length).toBe(1)
  await toolbarButton(page, 'Note').click()
  await writeNote(page, NASTY)
  await expect.poll(async () => (await annotations(book.id))[0]?.note).toBe(NASTY)

  // Read somewhere else, so a link that works cannot be the saved position.
  await jumpToChapter(page, 'Chapter 3:')

  // Open Highlights creates the note in the Books folder, in Read mode.
  await chromeUp(page)
  await reader(page).getByRole('button', { name: 'Notes' }).click()
  await page.getByRole('menuitem', { name: 'Open Highlights' }).click()
  const note = noteTileOf(page, 'The Long Crossing — Highlights')
  const links = note.locator('a[href^="velocity:"]')
  await expect(links.first()).toBeVisible(LOAD)
  const row = (await allNotes()).find((n) => n.title === 'The Long Crossing — Highlights')!
  expect(row).toBeTruthy()
  await expect.poll(() => noteContent(row.id)).toMatch(new RegExp(`^<!-- velocity-book-highlights:${book.id} -->`))
  const content = await noteContent(row.id)
  expect(content).toContain(`velocity://book/${book.id}?at=`)
  expect(content).toContain('## Chapter 20: Dunmarrow')

  // Nothing in the note is live: no image, no javascript: link, no script ran.
  await expect(note.locator('img')).toHaveCount(0)
  await expect(note.locator('a[href^="javascript"]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn)).toBeUndefined()
  await shot(page, 'books-v2-highlights-note')

  // Reader closed: the link opens it at the highlight.
  await closeReaders(page)
  await expect(reader(page)).toHaveCount(0)
  await links.first().click()
  await expect(reader(page)).toBeVisible(LOAD)
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe('Chapter 20: Dunmarrow')

  // Reader open and somewhere else: the same link brings it back.
  await focusReader(page)
  await page.keyboard.press('Home')
  await expect.poll(async () => (await status(page)).chapter, LOAD).not.toBe('Chapter 20: Dunmarrow')
  await expect(links.first()).toBeVisible()
  await links.first().click()
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe('Chapter 20: Dunmarrow')

  // Ctrl+click in the editor does the same.
  await focusReader(page)
  await page.keyboard.press('Home')
  await expect.poll(async () => (await status(page)).chapter, LOAD).not.toBe('Chapter 20: Dunmarrow')
  await note.locator('header').first().click() // focus the note tile: its Edit / Read switch is in the app toolbar
  await page.getByRole('radio', { name: 'Edit', exact: true }).click()
  await note.locator('.cm-md-link').first().click({ modifiers: ['Control'] })
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe('Chapter 20: Dunmarrow')
})

test('reopen exactly where I left off after a reload', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/')
  await openBook(page, LONG)
  const book = await bookByTitle('The Long Crossing')
  await jumpToChapter(page, 'Chapter 20: Dunmarrow')
  await focusReader(page)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await status(page)).page).toMatch(/^3 \/ \d+$/)
  const before = await status(page)

  // The position is written shortly after the last turn (debounced) and kept locally too.
  await expect.poll(async () => (await books()).find((b) => b.id === book.id)?.position ?? '', { timeout: 15_000 }).toMatch(/^epubcfi\(/)
  await page.waitForTimeout(2500)
  const saved = (await books()).find((b) => b.id === book.id)!.position

  await page.reload()
  await expect(reader(page)).toBeVisible(LOAD)
  await expect(reader(page).locator('iframe').first()).toBeVisible(LOAD)
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe(before.chapter)
  await page.waitForTimeout(2500)
  const after = await status(page)
  expect(after.chapter).toBe(before.chapter)
  expect(Math.abs(after.percent - before.percent)).toBeLessThanOrEqual(2)
  // The reader did not drift on open: nothing earlier was written over the saved place.
  expect((await books()).find((b) => b.id === book.id)!.position).toBe(saved)
})

test('PDF: pages, highlight, bookmark, scroll layout, reload', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/')
  await closeReaders(page)
  await openBook(page, HANDBOOK, 'pdf')
  const book = await bookByTitle('Velocity PDF Handbook')
  await expect.poll(async () => (await status(page)).page).toBe('p. 1 of 12')

  await focusReader(page)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await status(page)).page).toBe('p. 2 of 12')
  await tap(page, 0.92)
  await expect.poll(async () => (await status(page)).page).toBe('p. 3 of 12')
  await shot(page, 'books-v2-pdf-paper')

  // Highlight a line on page 3 (once the page turn has settled).
  await page.waitForTimeout(800)
  await reader(page).locator('.textLayer span:visible').nth(1).click({ clickCount: 3 })
  await expect(toolbar(page)).toBeVisible()
  await toolbarButton(page, 'Blue').click()
  await expect.poll(async () => (await annotations(book.id)).length).toBe(1)
  expect((await annotations(book.id))[0]).toMatchObject({ kind: 'highlight', color: 'blue', page: 3 })
  await openDrawer(page, /^Highlights/)
  await expect(drawer(page)).toContainText('Velocity keeps your notes')
  await expect(drawer(page)).toContainText('p. 3')
  await closeDrawer(page)

  // Contents jump, then a bookmark on that page.
  await jumpToChapter(page, 'Part III: Mastery')
  await expect.poll(async () => (await status(page)).page).toBe('p. 9 of 12')
  await focusReader(page)
  await page.keyboard.press('b')
  await expect.poll(async () => (await annotations(book.id)).filter((a) => a.kind === 'bookmark').map((a) => a.page)).toEqual([9])

  // Scroll layout and back keeps the page.
  await showOptions(page)
  await pick(page, 'Layout', 'Scroll')
  await expect.poll(async () => (await status(page)).page, LOAD).toBe('p. 9 of 12')
  await pick(page, 'Layout', 'Pages')
  await expect.poll(async () => (await status(page)).page, LOAD).toBe('p. 9 of 12')
  await expect.poll(async () => (await books()).find((b) => b.id === book.id)?.position ?? '', { timeout: 15_000 }).toMatch(/^page:9/)

  // Reload: the PDF reopens on page 9.
  await page.reload()
  await expect(reader(page)).toBeVisible(LOAD)
  await expect.poll(async () => (await status(page)).chapter, LOAD).toBe('Part III: Mastery')
  await expect.poll(async () => (await status(page)).page, LOAD).toBe('p. 9 of 12')
})

test('removing a book deletes its note and its highlights note', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/')
  await closeReaders(page)
  await openShelf(page)
  await expect(cards(page)).toHaveCount(3)
  const withNotes = (await allNotes()).filter((n) => /Velocity Sampler|Long Crossing|PDF Handbook/.test(n.title))
  // Three books, their notes, and the highlights notes of the ones that were annotated.
  expect(withNotes.length).toBeGreaterThanOrEqual(5)
  expect(withNotes.some((n) => n.title.endsWith('— Highlights'))).toBe(true)

  for (const card of [SAMPLER, LONG, HANDBOOK]) {
    await shelf(page).getByRole('listitem', { name: card }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Remove from Library/ }).click()
    await expect(page.getByText(/The book file, its note and its highlights are deleted/)).toBeVisible()
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(shelf(page).getByRole('listitem', { name: card })).toHaveCount(0)
  }
  await expect.poll(async () => (await books()).length).toBe(0)
  await expect
    .poll(async () => (await allNotes()).filter((n) => /Velocity Sampler|Long Crossing|PDF Handbook/.test(n.title)).length, { timeout: 15_000 })
    .toBe(0)
})
