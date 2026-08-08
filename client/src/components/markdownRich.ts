import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { resolveMediaUrl } from '../lib/api'
import {
  getLocalPreviewUrl,
  isPendingImageUrl,
  releaseLocalPreview,
} from '../lib/imageInsert'

/**
 * Obsidian-style "live preview" for CodeMirror markdown:
 *  - heading / emphasis / code styling applied to the source
 *  - syntax markers hidden unless the cursor is on that line
 *  - inline images rendered
 *  - task checkboxes rendered and clickable
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

/** Parse `![alt](url)` / `![alt](url "title")` — returns null when not an image. */
function parseImageMarkdown(text: string): { alt: string; url: string } | null {
  const match = /^!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)$/.exec(
    text.trim(),
  )
  if (!match) return null
  return { alt: match[1] ?? '', url: match[2]!.trim() }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super()
  }

  override eq(other: ImageWidget) {
    return this.alt === other.alt && this.url === other.url
  }

  // Reserve space so the line doesn't collapse before the image paints.
  override get estimatedHeight() {
    return 180
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image cm-md-image-loading'
    wrap.setAttribute('contenteditable', 'false')

    const placeholder = document.createElement('span')
    placeholder.className = 'cm-md-image-placeholder'
    placeholder.setAttribute('aria-busy', 'true')
    placeholder.setAttribute('aria-label', 'Loading image')
    wrap.appendChild(placeholder)

    const localPreview = getLocalPreviewUrl(this.url)
    const pending = isPendingImageUrl(this.url)
    const remoteSrc = resolveMediaUrl(this.url)

    const img = document.createElement('img')
    img.alt = this.alt
    img.decoding = 'async'
    img.className = pending ? 'cm-md-image-preview' : 'cm-md-image-remote'

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

    if (pending) {
      const badge = document.createElement('span')
      badge.className = 'cm-md-image-badge'
      badge.textContent = 'Uploading…'
      wrap.appendChild(badge)

      if (localPreview) {
        img.hidden = false
        img.onload = () => placeholder.remove()
        img.onerror = showError
        img.src = localPreview
        wrap.appendChild(img)
        if (img.complete && img.naturalWidth > 0) placeholder.remove()
      }
      return wrap
    }

    // Prefer local handoff blob while the durable asset URL warms up.
    if (localPreview) {
      img.hidden = false
      img.src = localPreview
      wrap.appendChild(img)
      placeholder.remove()
      wrap.classList.remove('cm-md-image-loading')

      const remote = new Image()
      remote.decoding = 'async'
      remote.onload = () => {
        img.onload = () => {
          releaseLocalPreview(this.url)
        }
        img.onerror = () => {
          // Keep the local preview if the remote swap fails.
        }
        img.src = remoteSrc
      }
      remote.src = remoteSrc
      return wrap
    }

    img.hidden = true
    img.onload = showImage
    img.onerror = showError
    wrap.appendChild(img)
    img.src = remoteSrc
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

function buildDecorations(view: EditorView): DecorationSet {
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
            Decorations.line({ class: headingClass }).range(
              state.doc.lineAt(node.from).from,
            ),
          )
          return
        }

        if (name === 'Image') {
          const text = state.doc.sliceString(node.from, node.to)
          const parsed = parseImageMarkdown(text)
          if (!parsed) return false
          // Keep upload placeholders visible; reveal source only when editing settled images.
          if (isActive(node.from, node.to) && !isPendingImageUrl(parsed.url)) {
            // Skip LinkMark children so the raw markdown stays fully editable.
            return false
          }
          widgets.push(
            Decorations.replace({
              widget: new ImageWidget(parsed.url, parsed.alt),
            }).range(node.from, node.to),
          )
          // Critical: skip LinkMark children — nested replace decorations inside an
          // Image replace hide the widget (marks collapse, no placeholder paints).
          return false
        }

        if (name === 'FencedCode' || name === 'CodeBlock') {
          const first = state.doc.lineAt(node.from).number
          const last = state.doc.lineAt(node.to).number
          for (let n = first; n <= last; n++) {
            widgets.push(
              Decorations.line({ class: 'cm-md-code' }).range(state.doc.line(n).from),
            )
          }
          return false
        }

        if (name === 'TaskMarker') {
          const text = state.doc.sliceString(node.from, node.to)
          const checked = /[xX]/.test(text)
          widgets.push(
            Decorations.replace({
              widget: new CheckboxWidget(checked, node.from),
            }).range(node.from, node.to),
          )
          return false
        }

        if (MARK_NODES.has(name)) {
          // keep ``` fences visible — hiding them makes code blocks confusing
          if (node.node.parent?.name === 'FencedCode') return
          // Image branch owns its marks; never nest LinkMark replaces inside Image.
          if (node.node.parent?.name === 'Image') return
          if (isActive(node.from, node.to)) return
          if (node.to > node.from) widgets.push(hiddenMark.range(node.from, node.to))
        }
      },
    })
  }

  // Fallback: decorate image markdown even if the syntax tree has not labeled
  // Image nodes yet (otherwise widgets only appear after a selection/viewport reset).
  const covered = new Set(widgets.map((w) => `${w.from}:${w.to}`))
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = state.doc.lineAt(pos)
      const m =
        /^(\s*)!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)\s*$/.exec(
          line.text,
        )
      if (m) {
        const start = line.from + m[1]!.length
        const end = start + m[0]!.length - m[1]!.length
        const key = `${start}:${end}`
        if (!covered.has(key)) {
          const url = m[3]!.trim()
          if (!(isActive(start, end) && !isPendingImageUrl(url))) {
            widgets.push(
              Decorations.replace({
                widget: new ImageWidget(url, m[2] ?? ''),
              }).range(start, end),
            )
            covered.add(key)
          }
        }
      }
      if (line.to >= to) break
      pos = line.to + 1
    }
  }

  widgets.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
  const builder = new RangeSetBuilder<Decoration>()
  for (const w of widgets) builder.add(w.from, w.to, w.value)
  return builder.finish()
}

class LivePreviewPlugin {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view)
  }

  update(update: ViewUpdate) {
    // Rebuild when the markdown tree catches up — otherwise Image widgets never
    // appear until the next selection/viewport change ("reset").
    const treeChanged =
      syntaxTree(update.state) !== syntaxTree(update.startState)
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      treeChanged
    ) {
      this.decorations = buildDecorations(update.view)
    }
  }
}

export const markdownLivePreview = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (v) => v.decorations,
})

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
