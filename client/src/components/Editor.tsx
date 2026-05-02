import { useEffect, useRef, useCallback } from 'react'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { useSearchStore } from '../store/searchStore'
import { useEditorStore } from '../store/editorStore'
import styles from './Editor.module.css'

interface EditorProps {
  content: string | undefined
  onChange: (content: string) => void
}

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
    background: '#1e1e1e',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: '1.5',
  },
  '.cm-content': {
    padding: '8px 12px',
    caretColor: '#ccc',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-gutters': {
    background: '#1e1e1e',
    border: 'none',
    borderRight: '1px solid #1e1e1e',
    color: '#444',
  },
  '.cm-activeLineGutter': {
    background: '#252526',
  },
  '.cm-activeLine': {
    background: '#252526',
  },
})

// App-level keybindings injected into CodeMirror so they fire even when the
// editor has focus (where window-level listeners are shadowed by CM's keymap).
function buildAppKeybindings() {
  return Prec.highest(
    keymap.of([
      {
        key: 'Mod-Shift-f',
        run: () => {
          useSearchStore.getState().openSearch()
          return true
        },
      },
      {
        key: 'Mod-n',
        run: () => {
          useEditorStore.getState().addPaste()
          return true
        },
      },
    ])
  )
}

const extensions = [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  lineNumbers(),
  highlightActiveLine(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  oneDark,
  baseTheme,
  EditorView.lineWrapping,
  buildAppKeybindings(),
]

export default function Editor({ content, onChange }: EditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const stableOnChange = useCallback((val: string) => onChangeRef.current(val), [])

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: content ?? '',
      extensions: [
        ...extensions,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) stableOnChange(update.state.doc.toString())
        }),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content ?? '' },
      })
    }
  }, [content])

  return <div ref={containerRef} className={styles.editor} />
}
