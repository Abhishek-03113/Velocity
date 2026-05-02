import { useEffect, useRef, useCallback } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle, LanguageDescription } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import styles from './Editor.module.css'

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

function buildExtensions(mode, onChange) {
  const base = [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    lineNumbers(),
    highlightActiveLine(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    oneDark,
    baseTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString())
      }
    }),
    EditorView.lineWrapping,
  ]

  if (mode === 'markdown') {
    base.push(
      markdown({
        base: markdownLanguage,
        codeLanguages: [],
      })
    )
  }

  return base
}

export default function Editor({ content, mode, onChange }) {
  const containerRef = useRef(null)
  const viewRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const stableOnChange = useCallback((val) => onChangeRef.current(val), [])

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: content ?? '',
      extensions: buildExtensions(mode, stableOnChange),
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]) // rebuild editor when mode changes

  // Sync external content changes without full rebuild
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
