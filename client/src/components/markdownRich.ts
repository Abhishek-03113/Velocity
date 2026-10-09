import { syntaxTree, ensureSyntaxTree } from '@codemirror/language'
import {
  EditorState,
  RangeSetBuilder,
  StateField,
  type Extension,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { resolveMediaUrl } from '../lib/api'
import { isPendingImageUrl } from '../lib/imageInsert'

/**
 * Obsidian-style "live preview" for CodeMirror markdown:
 *  - heading / emphasis / code styling applied to the source
 *  - syntax markers hidden unless the cursor is on that line
 *  - images always rendered via StateField block widgets (height-safe)
 *  - task checkboxes rendered and clickable
 *
 * Images MUST come from a StateField, not a ViewPlugin: widgets that change
 * vertical layout are applied after the viewport is computed when provided by
 * a ViewPlugin, so Image replace widgets never stably paint.
 */

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
}

const MARK_NODES = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'LinkMark',
  'QuoteMark',
])

const hiddenMark = Decoration.replace({})

class BulletWidget extends WidgetType {
  override eq() {
    return true
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-md-bullet'
    span.textContent = '•'
    return span
  }
}

const bulletWidget = new BulletWidget()

/** Parse `![alt](url)` / `![alt](url "title")` — returns null when not an image. */
export function parseImageMarkdown(text: string): { alt: string; url: string } | null {
  const match = /^!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)$/.exec(
    text.trim(),
  )
  if (!match) return null
  return { alt: match[1] ?? '', url: match[2]!.trim() }
}

function imageLineRegex() {
  return /^(\s*)!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)\s*$/
}

/** True when markdown image src is a durable/fetchable URL (not an upload stub). */
export function isReadyImageUrl(url: string): boolean {
  if (!url || isPendingImageUrl(url)) return false
  return (
    url.startsWith('/api/assets/') ||
    url.startsWith('data:image/') ||
    url.startsWith('blob:') ||
    url.startsWith('http://') ||
    url.startsWith('https://')
  )
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super()
  }

  override eq(other: ImageWidget) {
    return this.alt === other.alt && this.url === other.url
  }

  override get estimatedHeight() {
    return 180
  }

  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-image cm-md-image-loading'
    wrap.setAttribute('contenteditable', 'false')

    const placeholder = document.createElement('span')
    placeholder.className = 'cm-md-image-placeholder'
    placeholder.setAttribute('aria-busy', 'true')
    placeholder.setAttribute('aria-label', 'Loading image')
    placeholder.innerHTML =
      '<svg class="cm-md-image-placeholder-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>' +
      '<circle cx="9" cy="10" r="1.5" fill="currentColor"/>' +
      '<path d="M4 16l5-5 4 4 3-3 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>'
    wrap.appendChild(placeholder)

    // Upload still in flight — keep the generic placeholder until the asset URL lands.
    if (!isReadyImageUrl(this.url)) {
      const badge = document.createElement('span')
      badge.className = 'cm-md-image-badge'
      badge.textContent = 'Uploading…'
      wrap.appendChild(badge)
      return wrap
    }

    const img = document.createElement('img')
    img.alt = this.alt || 'image'
    img.decoding = 'async'
    img.className = 'cm-md-image-remote'
    img.hidden = true

    const showImage = () => {
      placeholder.remove()
      img.hidden = false
      wrap.classList.remove('cm-md-image-loading')
    }

    const showError = () => {
      img.remove()
      placeholder.classList.add('cm-md-image-error')
      placeholder.removeAttribute('aria-busy')
      placeholder.setAttribute('aria-label', 'Failed to load image')
      placeholder.textContent = 'Image failed to load'
      wrap.classList.remove('cm-md-image-loading')
    }

    img.onload = showImage
    img.onerror = showError
    wrap.appendChild(img)
    img.src = resolveMediaUrl(this.url)
    if (img.complete && img.naturalWidth > 0) showImage()
    return wrap
  }

  override ignoreEvent() {
    return true
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super()
  }

  override eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos
  }

  toDOM(view: EditorView) {
    const box = document.createElement('span')
    box.className = `cm-md-task${this.checked ? ' cm-md-task-done' : ''}`
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    box.textContent = this.checked ? '✓' : ''
    box.onmousedown = (e) => {
      e.preventDefault()
      const from = this.pos
      const to = from + 3
      view.dispatch({
        changes: { from, to, insert: this.checked ? '[ ]' : '[x]' },
      })
    }
    return box
  }

  override ignoreEvent() {
    return false
  }
}

function cursorLines(state: EditorState) {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number
    const end = state.doc.lineAt(range.to).number
    for (let n = start; n <= end; n++) lines.add(n)
  }
  return lines
}

export type ImageRange = {
  from: number
  to: number
  alt: string
  url: string
  lineFrom: number
  lineTo: number
  soleOnLine: boolean
}

/** Collect markdown image ranges from the syntax tree (with line-regex fallback). */
export function collectImageRanges(state: EditorState): ImageRange[] {
  ensureSyntaxTree(state, state.doc.length, 5000)
  const found: ImageRange[] = []
  const covered = new Set<string>()

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Image') return
      const text = state.doc.sliceString(node.from, node.to)
      const parsed = parseImageMarkdown(text)
      if (!parsed) return false
      const line = state.doc.lineAt(node.from)
      const key = `${node.from}:${node.to}`
      covered.add(key)
      found.push({
        from: node.from,
        to: node.to,
        alt: parsed.alt,
        url: parsed.url,
        lineFrom: line.from,
        lineTo: line.to,
        soleOnLine: imageLineRegex().test(line.text),
      })
      return false
    },
  })

  const lineRe = imageLineRegex()
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    const m = lineRe.exec(line.text)
    if (!m) continue
    const from = line.from + m[1]!.length
    const to = from + m[0]!.length - m[1]!.length
    const key = `${from}:${to}`
    if (covered.has(key)) continue
    found.push({
      from,
      to,
      alt: m[2] ?? '',
      url: m[3]!.trim(),
      lineFrom: line.from,
      lineTo: line.to,
      soleOnLine: true,
    })
  }

  return found
}

/**
 * Build image decorations for live preview.
 * - Cursor off the image line: block-replace the line with the image (source hidden).
 * - Cursor on the image line: keep source editable and show a block preview below.
 */
export function buildImageDecorations(state: EditorState): DecorationSet {
  const active = cursorLines(state)
  const widgets: Range<Decoration>[] = []

  for (const img of collectImageRanges(state)) {
    const editing = active.has(state.doc.lineAt(img.from).number)
    const widget = new ImageWidget(img.url, img.alt)

    if (editing) {
      // Source stays editable; preview remains visible (Read-mode parity on focus).
      widgets.push(
        Decoration.widget({
          widget,
          block: true,
          side: 1,
        }).range(img.lineTo),
      )
      continue
    }

    if (img.soleOnLine) {
      // Block replacements must cover the trailing line break when present.
      const end = img.lineTo < state.doc.length ? img.lineTo + 1 : img.lineTo
      widgets.push(
        Decoration.replace({
          widget,
          block: true,
        }).range(img.lineFrom, end),
      )
    } else {
      widgets.push(
        Decoration.replace({
          widget,
        }).range(img.from, img.to),
      )
    }
  }

  widgets.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
  const builder = new RangeSetBuilder<Decoration>()
  for (const w of widgets) builder.add(w.from, w.to, w.value)
  return builder.finish()
}

/** Height-changing image widgets — must be a StateField (not a ViewPlugin). */
export const markdownImagePreview = StateField.define<DecorationSet>({
  create: buildImageDecorations,
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return buildImageDecorations(tr.state)
    return deco.map(tr.changes)
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
})

function buildMarkDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const active = cursorLines(state)
  const widgets: Range<Decoration>[] = []
  const isActive = (from: number, to: number) => {
    const a = state.doc.lineAt(from).number
    const b = state.doc.lineAt(to).number
    for (let n = a; n <= b; n++) if (active.has(n)) return true
    return false
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name

        const headingClass = HEADING_CLASS[name]
        if (headingClass) {
          widgets.push(
            Decoration.line({ class: headingClass }).range(
              state.doc.lineAt(node.from).from,
            ),
          )
          return
        }

        // Images are owned by markdownImagePreview (StateField).
        if (name === 'Image') return false

        if (name === 'FencedCode' || name === 'CodeBlock') {
          const first = state.doc.lineAt(node.from).number
          const last = state.doc.lineAt(node.to).number
          for (let n = first; n <= last; n++) {
            widgets.push(
              Decoration.line({ class: 'cm-md-code' }).range(state.doc.line(n).from),
            )
          }
          return false
        }

        if (name === 'Blockquote') {
          const first = state.doc.lineAt(node.from).number
          const last = state.doc.lineAt(node.to).number
          for (let n = first; n <= last; n++) {
            widgets.push(Decoration.line({ class: 'cm-md-quote' }).range(state.doc.line(n).from))
          }
          return
        }

        if (name === 'TaskMarker') {
          const text = state.doc.sliceString(node.from, node.to)
          const checked = /[xX]/.test(text)
          widgets.push(
            Decoration.replace({
              widget: new CheckboxWidget(checked, node.from),
            }).range(node.from, node.to),
          )
          return false
        }

        if (name === 'ListMark') {
          if (isActive(node.from, node.to)) return
          const next = node.node.nextSibling
          const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
          // Checklist items render just the checkbox (Apple Notes) — drop the "- ".
          if (next?.name === 'Task') {
            widgets.push(hiddenMark.range(node.from, end))
            return
          }
          if (node.node.parent?.parent?.name === 'BulletList') {
            widgets.push(Decoration.replace({ widget: bulletWidget }).range(node.from, node.to))
          }
          return
        }

        if (MARK_NODES.has(name)) {
          // keep ``` fences visible — hiding them makes code blocks confusing
          if (node.node.parent?.name === 'FencedCode') return
          if (node.node.parent?.name === 'Image') return
          if (isActive(node.from, node.to)) return
          // Hide the space after "##" / ">" too, so text sits flush with paragraphs.
          const trailing =
            (name === 'HeaderMark' || name === 'QuoteMark') &&
            state.doc.sliceString(node.to, node.to + 1) === ' '
          const to = trailing ? node.to + 1 : node.to
          if (to > node.from) widgets.push(hiddenMark.range(node.from, to))
        }
      },
    })
  }

  widgets.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
  const builder = new RangeSetBuilder<Decoration>()
  for (const w of widgets) builder.add(w.from, w.to, w.value)
  return builder.finish()
}

class MarkPreviewPlugin {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildMarkDecorations(view)
  }

  update(update: ViewUpdate) {
    const treeChanged =
      syntaxTree(update.state) !== syntaxTree(update.startState)
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      treeChanged
    ) {
      this.decorations = buildMarkDecorations(update.view)
    }
  }
}

const markdownMarkPreview = ViewPlugin.fromClass(MarkPreviewPlugin, {
  decorations: (v) => v.decorations,
})

/** Live-preview extension set: images (StateField) + marks/headings/tasks (ViewPlugin). */
export const markdownLivePreview: Extension = [
  markdownImagePreview,
  markdownMarkPreview,
]

/** Wrap (or unwrap) the selection with `mark` — bold, italic, inline code. */
export function toggleWrap(mark: string) {
  return (view: EditorView) => {
    view.dispatch(
      view.state.changeByRange((range) => {
        const before = view.state.sliceDoc(range.from - mark.length, range.from)
        const after = view.state.sliceDoc(range.to, range.to + mark.length)
        const spec =
          before === mark && after === mark
            ? [
                { from: range.from - mark.length, to: range.from },
                { from: range.to, to: range.to + mark.length },
              ]
            : [
                { from: range.from, insert: mark },
                { from: range.to, insert: mark },
              ]
        const changes = view.state.changes(spec)
        return { changes, range: range.map(changes) }
      }),
      { scrollIntoView: true, userEvent: 'input' },
    )
    return true
  }
}

/** Turn the selection into a markdown link, keeping the text as the label. */
export function insertLink(view: EditorView) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to)
      const insert = `[${text}](url)`
      const changes = view.state.changes({
        from: range.from,
        to: range.to,
        insert,
      })
      return { changes, range: range.map(changes) }
    }),
    { scrollIntoView: true, userEvent: 'input' },
  )
  return true
}

/** Apply `transform` to every line touched by the selection. */
function mapSelectedLines(view: EditorView, transform: (text: string) => string) {
  const { state } = view
  const seen = new Set<number>()
  const changes: { from: number; to: number; insert: string }[] = []
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      const next = transform(line.text)
      if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
    }
  }
  if (changes.length) view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' })
  return true
}

/** ⇧⌘L — turn lines into a checklist, or back into plain text (Apple Notes). */
export function toggleChecklist(view: EditorView) {
  return mapSelectedLines(view, (text) => {
    const task = /^(\s*)[-*+]\s+\[[ xX]\]\s?/.exec(text)
    if (task) return task[1] + text.slice(task[0].length)
    const bullet = /^(\s*)[-*+]\s+/.exec(text)
    if (bullet) return `${bullet[1]}- [ ] ${text.slice(bullet[0].length)}`
    const indent = /^\s*/.exec(text)![0]
    return `${indent}- [ ] ${text.slice(indent.length)}`
  })
}

/** ⇧⌘H — cycle a line through H1 → H2 → H3 → body text. */
export function cycleHeading(view: EditorView) {
  return mapSelectedLines(view, (text) => {
    const m = /^(#{1,6})\s+/.exec(text)
    const level = m ? m[1]!.length : 0
    const body = m ? text.slice(m[0].length) : text
    if (level >= 3) return body
    return `${'#'.repeat(level + 1)} ${body}`
  })
}
