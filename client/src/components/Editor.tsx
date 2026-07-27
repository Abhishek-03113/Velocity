import { useEffect, useRef, useCallback } from 'react'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { useSearchStore } from '../store/searchStore'
import { useEditorStore } from '../store/editorStore'
import styles from './Editor.module.css'

export type EditorMode = 'plain' | 'markdown'

interface EditorProps {
  content: string | undefined
  onChange: (content: string) => void
  mode: EditorMode
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
  const handleNew = () => {
    useEditorStore.getState().addPaste()
    return true
  }
  const handleClose = () => {
    const { activeId, closeTab } = useEditorStore.getState()
    if (activeId != null) closeTab(activeId)
    return true
  }

  return Prec.highest(
    keymap.of([
      { key: 'Mod-f', run: openSearchPanel },
      { key: 'Mod-Shift-f', run: () => { useSearchStore.getState().openSearch(); return true } },
      { key: 'Mod-n', run: handleNew },
      { key: 'Ctrl-n', run: handleNew },
      { key: 'Mod-w', run: handleClose },
      { key: 'Ctrl-w', run: handleClose },
    ])
  )
}

function buildExtensions(mode: EditorMode) {
  return [
    history(),
    search({ top: true }),
    keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap]),
    lineNumbers(),
    highlightActiveLine(),
    ...(mode === 'markdown' ? [markdown()] : []),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    oneDark,
    baseTheme,
    EditorView.lineWrapping,
    buildAppKeybindings(),
  ]
}

export default function Editor({ content, onChange, mode }: EditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const applyingExternalChangeRef = useRef(false)
  onChangeRef.current = onChange

  const stableOnChange = useCallback((val: string) => onChangeRef.current(val), [])

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: content ?? '',
      extensions: [
        ...buildExtensions(mode),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternalChangeRef.current) {
            stableOnChange(update.state.doc.toString())
          }
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
  }, [mode, stableOnChange])

  useEffect(() => {
    function handleInlineSearch() {
      const view = viewRef.current
      if (view) {
        openSearchPanel(view)
        view.focus()
      }
    }

    window.addEventListener('velocity:open-inline-search', handleInlineSearch)
    return () => window.removeEventListener('velocity:open-inline-search', handleInlineSearch)
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== content) {
      applyingExternalChangeRef.current = true
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content ?? '' },
      })
      applyingExternalChangeRef.current = false
    }
  }, [content])

  return <div ref={containerRef} className={styles.editor} />
}
