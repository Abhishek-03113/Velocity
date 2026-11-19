import { syntaxTree } from '@codemirror/language'
import { EditorView, ViewPlugin } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { isMac } from './platform'
import { openVelocityLink } from './openLink'

const isMod = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey)

/** The destination of the Markdown link / autolink / bare URL at `pos`, or null. */
export function linkAt(view: EditorView, pos: number): string | null {
  // A click on a link's first or last character resolves to the edge, so look to both sides.
  for (const side of [0, 1, -1] as const) {
    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, side)
    for (; node; node = node.parent) {
      if (node.name === 'Image') return null
      if (node.name === 'URL') return view.state.sliceDoc(node.from, node.to)
      if (node.name === 'Link' || node.name === 'Autolink') {
        const url = node.getChild('URL')
        return url ? view.state.sliceDoc(url.from, url.to) : null
      }
    }
  }
  return null
}

/**
 * Mod/Ctrl+click on a link opens it: `velocity://` through the plugin that handles it, http(s) in a new tab.
 * A plain click still just places the cursor.
 */
export const linkOpenHandler = [
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !isMod(event)) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos == null) return false
      const href = linkAt(view, pos)?.replace(/^<|>$/g, '')
      if (!href) return false
      if (/^velocity:/i.test(href)) {
        event.preventDefault()
        return openVelocityLink(href, event.shiftKey || event.altKey)
      }
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault()
        window.open(href, '_blank', 'noopener,noreferrer')
        return true
      }
      return false
    },
  }),
  // Show the pointer cursor over links while the modifier is held.
  ViewPlugin.fromClass(
    class {
      private readonly sync = (e: KeyboardEvent) => this.view.dom.classList.toggle('cm-link-mod', isMod(e))
      private readonly clear = () => this.view.dom.classList.remove('cm-link-mod')
      constructor(private readonly view: EditorView) {
        window.addEventListener('keydown', this.sync)
        window.addEventListener('keyup', this.sync)
        window.addEventListener('blur', this.clear)
      }
      destroy() {
        window.removeEventListener('keydown', this.sync)
        window.removeEventListener('keyup', this.sync)
        window.removeEventListener('blur', this.clear)
        this.clear()
      }
    },
  ),
]
