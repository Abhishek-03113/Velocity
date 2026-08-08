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

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super()
  }

  override eq(other: ImageWidget) {
    return other.url === this.url && other.alt === this.alt
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image'
    const img = document.createElement('img')
    img.src = this.url
    img.alt = this.alt
    wrap.appendChild(img)
    return wrap
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
            Decoration.line({ class: headingClass }).range(
              state.doc.lineAt(node.from).from,
            ),
          )
          return
        }

        if (name === 'Image') {
          if (isActive(node.from, node.to)) return
          const text = state.doc.sliceString(node.from, node.to)
          const match = /^!\[([^\]]*)\]\(([^)\s]+)/.exec(text)
          if (!match) return
          widgets.push(
            Decoration.replace({
              widget: new ImageWidget(match[2]!, match[1] ?? ''),
            }).range(node.from, node.to),
          )
          return
        }

        if (name === 'FencedCode' || name === 'CodeBlock') {
          const first = state.doc.lineAt(node.from).number
          const last = state.doc.lineAt(node.to).number
          for (let n = first; n <= last; n++) {
            widgets.push(
              Decoration.line({ class: 'cm-md-code' }).range(state.doc.line(n).from),
            )
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
          return
        }

        if (MARK_NODES.has(name)) {
          // keep ``` fences visible — hiding them makes code blocks confusing
          if (node.node.parent?.name === 'FencedCode') return
          if (isActive(node.from, node.to)) return
          if (node.to > node.from) widgets.push(hiddenMark.range(node.from, node.to))
        }
      },
    })
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
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
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
