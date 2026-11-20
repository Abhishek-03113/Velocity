# Books v2: reading experience spec

Status: approved for build · Board: Agent Command Center, ACC-34 to ACC-40 · Integration branch:
`feat/books-reading-experience` (from `main` after PR #19) · Builds on `docs/specs/books-plugin.md`.

Reading in Velocity has to feel like a dedicated reader, not a web page in a tile. Today's reader (see
the user's screenshot: justified text with rivers, no margins or paragraph rhythm, flat background, no
way to mark anything) does not. **Moon+ Reader** is the reference for behaviour and density: tap zones,
immersive chrome, a status line, a rich Visual Options sheet, a selection toolbar with styles and colours,
and a bookmarks/highlights list. Velocity's own look (tokens, Apple HIG chrome) stays: Moon+ is the
model for *what* a reader does, Velocity for *how it looks*.

Contracts already committed: `client/src/plugins/books/reader/types.ts` (engine v2: appearance fields,
`ReaderAnnotation`, `onTap`, `onAnnotationClick`, selection `locator`) and
`client/src/plugins/books/types.ts` (`BookAnnotation`, `ReaderHost` v2 members, `bookLink` /
`parseBookLink`). New members are optional so `main` compiles; each task makes its side real.

## 1. User stories

| ID | Story | Task |
|---|---|---|
| US-8 | As a reader, I choose **page-by-page reading with a page-turn effect** (Curl, Slide, Fade, None) or **continuous scrolling**, for EPUB and PDF, and switching keeps my place. | ACC-36, ACC-37, ACC-38 |
| US-9 | As a reader, the page looks like **ink on paper** in every Velocity theme (light and dark), with comfortable typography I can tune: size, font, line and paragraph spacing, margins, left or justified with hyphenation. | ACC-36, ACC-38 |
| US-10 | As a reader, I **highlight** a passage in a colour and style (highlight, underline, strikethrough, squiggly), add a note to it, and **bookmark** pages, like in Moon+ Reader. | ACC-34, ACC-36, ACC-37, ACC-38, ACC-39 |
| US-11 | As a note-taker, every book has **one highlights note** in the Books folder that collects all its highlights, notes and bookmarks, each with a **link back to its place** in the book. | ACC-35, ACC-39 |
| US-12 | As a reader, a book **always reopens on the page I left**: after closing the tile, reloading, switching layout or text size, and on another device. | ACC-36, ACC-37, ACC-38, ACC-39 |

## 2. Architecture and ownership

| Task | Owner | Files (new or main edits) |
|---|---|---|
| ACC-34 Server annotations | books-server | `server/plugins/books/annotations.ts` (+ router wiring), `server/tests/books-annotations.test.ts` |
| ACC-35 In-note plugin links | books-host | `plugins/types.ts` (`linkHandler`), `plugins/host.ts` (`linkHandlerFor`), link clicks in `components/MarkdownPreview.tsx` and the rich editor (`components/markdownRich.ts` / `Editor.tsx`), sanitizer allows `velocity:` |
| ACC-36 EPUB engine v2 | books-epub | `reader/epub/*` only |
| ACC-37 PDF engine v2 | books-pdf | `reader/pdf/*` only |
| ACC-38 Reader shell v2 | books-reader | `ReaderView.tsx`, `ReaderParts.tsx` (split into `reader-ui/*` as needed), `ReaderTile.module.css`, `appearance.ts`, `useReaderColors.ts`, `paper.ts`, `labels.ts`, `position.ts`, `Icon.tsx` |
| ACC-39 Annotations store, highlights note, links | books-shelf | `annotations.ts` (store + api), `highlightsNote.ts`, `host.ts`, `index.ts`, `api.ts`, `note.ts` |
| ACC-40 QA | books-qa | `client/e2e/books-reading.spec.ts`, fixtures, docs, screenshots |

Engines never import the store or host; the shell never touches epub.js / pdf.js directly.

## 3. Reading surface (US-8, US-9)

### 3.1 Layouts and page turns
- `appearance.layout`: `'paginated'` (pages) or `'scrolled'` (continuous scroll). Applies to **both** formats.
  - EPUB paged: epub.js paginated flow, one page or a two-page spread when the tile is ≥ 900px wide.
    EPUB scroll: **continuous across chapters** (`manager: 'continuous', flow: 'scrolled'`), no chapter breaks
    you have to click through.
  - PDF paged: one page at a time, fitted (fit-page by default in paged), turned with the effect.
    PDF scroll: today's virtualised column.
- `appearance.pageTurn` (paged only): **Curl** (a page flip: the page folds from its corner along a moving fold line,
  back of the leaf and fold shadows showing, the next page revealed underneath, 640 ms; ACC-52), **Slide** (default;
  the old sheet is pushed out as the next arrives edge to edge, 280 ms, `--ease-out`), **Fade** (140 ms cross-fade),
  **None**. No effect may flash: book iframes are pinned to `color-scheme: light`. `prefers-reduced-motion` forces None. Turns must stay at
  60 fps on a mid laptop; never block input (queue at most one extra turn on rapid presses).
- Input, as in Moon+: **tap zones** (left 30% previous, right 30% next, middle toggles the chrome), **swipe**
  left/right on touch and trackpad horizontal scroll in paged, keys ←/→ PageUp/PageDown Space Shift+Space Home End,
  mouse wheel in scroll layout. Taps on links, highlights and selections are not page turns.
- Switching layout, font size, spacing or margins keeps the **same first visible text** in view.

### 3.2 Paper and typography
- New default reader theme **Paper**: a paper stock derived from the active Velocity theme so the reader matches
  the app in every family (Apple, Catppuccin, Gruvbox, Everforest, Nord, Solarized, light and dark):
  - paper = `color-mix(in oklab, var(--bg-content) 88%, <warm tint>)`, warm tint `#f3e7cf` on light themes and
    `#2a2420` on dark ones; ink = `color-mix(in oklab, var(--label) 92%, <ink tint>)` (`#2b2118` light / `#efe4d2`
    dark); muted = ink at 60%.
  - grain: an inline SVG `feTurbulence` noise as a data-URI `background-image`, opacity ~4% light / ~6% dark,
    plus a very soft inner vignette at the page edges. Computed in `paper.ts` (ACC-38) and handed to engines as
    `ReaderColors.background`, `text`, `muted`, `backgroundImage`, `highlights`.
- Light, Sepia and Dark stay as fixed stocks; Auto stays "plain app colours". Theme chips: Paper · Auto ·
  Light · Sepia · Dark.
- Typography defaults (EPUB): serif stack `"Iowan Old Style", "Charter", "Literata", Georgia, serif`; size 100%
  (≈ 19px); line height 1.6; paragraph spacing 0.6em with no first-line indent, or the book's indent when
  spacing is 0; **left-aligned by default**; Justify always turns on `hyphens: auto` and
  `text-wrap: pretty`; measure capped at ~68ch; margins Narrow 24px / Normal 48px / Wide 88px (scaled down
  under 600px); headings in the same serif, centred, with space above; images max-width 100%, centred.
  Publisher fonts keep the book's family but our spacing and colours.
- Highlight fills (`ReaderColors.highlights`): yellow/green/blue/pink/orange tuned per stock (≈ 35% alpha on
  light paper, 30% on dark); underline/strike/squiggle use the colour at full strength, 2px.
- PDF pages: Paper tints the page with `multiply` (light) and inverts with a warm ink in dark (keep images
  bearable), grain on the margins around the page.

### 3.3 Chrome (Moon+ immersive)
- The top bar (Contents, chapter, bookmark ribbon, Visual Options, Notes) and a bottom **status line**
  auto-hide after 3 s of reading in paged layout and on a 'center' tap; any tap in the middle or moving the
  pointer to the top/bottom edge shows them. Scroll layout keeps them visible but subtle.
- Status line (muted ink, footnote size): left `Chapter title`, centre `5 / 18` (page in chapter for EPUB paged,
  `p. 12 of 300` for PDF), right `42%`. A thin progress track sits under it (click/drag to seek).
- **Visual Options** sheet (replaces the Appearance popover; Moon+ "Visual Options" density, HIG styling):
  Theme chips · Layout Pages/Scroll · Page turn Curl/Slide/Fade/None · Font Serif/Sans/Original · Size −/+ ·
  Line spacing −/+ · Paragraph spacing −/+ · Margins Narrow/Normal/Wide · Align Left/Justify · (PDF) Fit and zoom.
  Changes apply live under the sheet. A **Reset** link restores defaults.

## 4. Highlights and bookmarks (US-10)

- **Selection toolbar** (Moon+ style, floating above or below the selection, flips to stay in the tile):
  row 1 styles (Highlight, Underline, Strike, Squiggle) as icon toggles; row 2 five colour dots; row 3 actions
  **Copy · Note · Quote in Notes · Share?** (no Share: Copy covers it). Choosing a style or colour creates the
  highlight at once with the last-used style/colour remembered; the toolbar stays for adjustments.
- Tapping an existing highlight opens the same toolbar for it with **Note**, **Copy**, **Delete** and the
  current style/colour selected.
- **Note**: a small sheet with a multi-line field (⌘↩ saves, Esc cancels). Highlights with a note show a small
  note mark in the margin (EPUB) or at the end of the highlight.
- **Bookmarks**: a ribbon button in the top bar toggles a bookmark on the current page (paged) or current
  position (scroll); a bookmarked page shows a ribbon in its top-right corner. `B` toggles it from the keyboard.
- **Contents drawer** becomes three tabs: **Contents · Bookmarks · Highlights** (like Moon+). Lists show colour
  swatch, text (3-line clamp), chapter and page/percent, date and note; click to go there; an overflow menu per
  row (Go to, Edit note, Copy, Delete); a Clear All per tab with a destructive confirm. Highlights tab can filter
  by colour.
- Everything is local-first: the store updates instantly, the server is written in the background; offline
  edits sync later (same retry rules as reading position).

### 4.1 Server (ACC-34)

```sql
CREATE TABLE IF NOT EXISTS plugin_book_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES plugin_books(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('highlight','bookmark')),
  locator TEXT NOT NULL, text TEXT, note TEXT,
  color TEXT CHECK (color IN ('yellow','green','blue','pink','orange')),
  style TEXT CHECK (style IN ('highlight','underline','strike','squiggle')),
  chapter TEXT, progress REAL NOT NULL DEFAULT 0, page INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS plugin_book_annotations_book ON plugin_book_annotations(book_id, progress);
```

| Method | Path | Behaviour |
|---|---|---|
| GET | `/:id/annotations` | `BookAnnotation[]` ordered by `progress, created_at`; 404 if the book is missing |
| POST | `/:id/annotations` | Zod: `kind`; `locator` 1–4000; `text` ≤ 10000 or null (required for highlights); `note` ≤ 10000 or null; `color`/`style` required for highlights, null for bookmarks; `chapter` ≤ 300 or null; `progress` 0–1; `page` int ≥ 1 or null. A bookmark with the same `locator` returns the existing one (200), else 201 |
| PATCH | `/:id/annotations/:aid` | `color`, `style`, `note` (strict); bumps `updated_at`; 404 when not this book's |
| DELETE | `/:id/annotations/:aid` | 404 when missing; `{ id }` |
| DELETE | `/:id/annotations?kind=highlight|bookmark` | Clear all of a kind; `{ deleted: n }` |

Deleting a book cascades to its annotations (foreign keys are on in `server/db/client.ts`).

## 5. Highlights note (US-11)

One note per book in the Books folder, titled `<Book title> — Highlights`, owned by the plugin and rebuilt
from the annotations (debounced 1 s after any change, and on open). Marker on line 1:
`<!-- velocity-book-highlights:<bookId> -->` (hidden in the editor and Read mode like the book marker).

```md
<!-- velocity-book-highlights:12 -->
> **Strange Weather in Tokyo** · Hiromi Kawakami · 14 highlights · 3 bookmarks · updated 19 Nov 2026

## The Moon and the Batteries

> His full name was Mr. Harutsuna Matsumoto, but I called him “Sensei.”
>
> 🟡 [p. 3 · 4%](velocity://book/12?at=epubcfi(...)) · 19 Nov 2026

**Note:** reminds me of …

## Bookmarks

- [The Moon and the Batteries · 4%](velocity://book/12?at=epubcfi(...)) · 19 Nov 2026
```

- Colour marker is a coloured dot emoji (🟡 🟢 🔵 🩷 🟠) so it survives Markdown export; style is named when not
  a plain highlight (`underline`, `strikethrough`, `squiggly`).
- Links use `bookLink(bookId, locator)`; clicking one (Read mode, or the rich editor's link click) opens the
  reader tile at that place (ACC-35 routes `velocity://` links to the plugin's `linkHandler`; ACC-39 handles
  `velocity://book/...`). The note opens in Read mode by default.
- The book note (user's own notes and quotes) is unchanged. Removing a book deletes both notes after the
  destructive confirm (copy: "The book file, its note and its highlights are deleted from Velocity.").
- The Bookshelf card menu and the reader's Notes menu gain **Open Highlights** (shown once a book has any).

## 6. Reopen exactly where I left off (US-12)

- The position written is the **first visible text** (EPUB: start CFI of the visible range; PDF: page plus
  in-page offset, `page:12@0.35` — engines must accept both `page:12` and `page:12@0.35`).
- Restoring must land on the page containing that text in every layout and size; after a restore, the engine
  must not emit a position earlier than the restored one (no drift on reopen, the bug QA fixed in v1 must stay
  fixed and be covered by a test).
- Sources, newest wins: in-memory store (same session) → `ctx.storage` `pos.<bookId>` → server row. Closing and
  reopening the reader tile in the same session must not wait for the server.
- The Bookshelf card says **Continue · 42%** on hover/focus for books in progress and opens straight there.
- A long fixture (`client/e2e/fixtures/books/long.epub`, ≥ 30 chapters, generated by `make-epub.ts`) is used
  to test positions deep in a book.

## 7. Definition of done (every task)

- Lint, `tsc --noEmit`, `npm run typecheck:e2e`, the touched unit tests (CLAUDE.md: never the full suites,
  never Playwright locally except standalone browser scripts), the server test if touched, and `npm run build`
  (engines stay out of the main chunk).
- Real-browser check with a standalone Playwright script for anything visual; **screenshots go to the
  scratchpad and are listed in the report so the orchestrator attaches them to the card** (board rule: every
  visual task carries images).
- Tokens only (the fixed stocks and highlight palette live in one constant), all theme families light and dark,
  phone width, `prefers-reduced-motion`. No toasts.
- Conventional Commits, one branch per task, pushed. New code is TypeScript.
