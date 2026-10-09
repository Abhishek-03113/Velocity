import { memo, useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  placeholder as cmPlaceholder,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { search, searchKeymap } from '@codemirror/search'
import { useEditorStore } from '../store/editorStore'
import { registerEditor, unregisterEditor } from '../lib/editorRegistry'
import { isMac } from '../lib/platform'
import {
  markdownLivePreview,
  toggleWrap,
  insertLink,
  toggleChecklist,
  cycleHeading,
} from './markdownRich'
import { insertImageFiles, migrateEmbeddedDataUrls } from '../lib/imageInsert'
import styles from './Editor.module.css'

interface EditorProps {
  noteId: number
  spellcheck: boolean
}

/** Syntax colours reference semantic tokens so light/dark/accent just work. */
const highlight = HighlightStyle.define([
  { tag: t.heading, color: 'var(--label)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, color: 'var(--label-tertiary)', textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent-text)', textDecoration: 'underline' },
  { tag: [t.monospace, t.literal], fontFamily: 'var(--font-mono)', fontSize: '0.9em', color: 'var(--system-pink)' },
  { tag: t.quote, color: 'var(--label-secondary)' },
  { tag: [t.comment, t.meta, t.processingInstruction], color: 'var(--label-tertiary)' },
  { tag: [t.keyword, t.operator, t.modifier], color: 'var(--system-pink)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--system-red)' },
  { tag: [t.number, t.bool, t.atom], color: 'var(--system-purple)' },
  { tag: [t.variableName, t.propertyName, t.attributeName], color: 'var(--system-teal)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--system-indigo)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--system-blue)' },
  { tag: t.invalid, color: 'var(--system-red)' },
])

const theme = EditorView.theme({
  '&': {
    height: '100%',
    width: '100%',
    fontSize: 'var(--editor-size)',
    fontFamily: 'var(--editor-font)',
    background: 'transparent',
    color: 'var(--label)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: 'var(--editor-line-height)',
    fontFamily: 'inherit',
  },
  '.cm-content': {
    padding: '28px 0 40vh',
    caretColor: 'var(--accent)',
    maxWidth: 'var(--editor-measure)',
    margin: '0 auto',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0 28px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    background: 'var(--editor-selection) !important',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    background: 'var(--fill-secondary)',
    outline: 'none',
  },
  '.cm-searchMatch': {
    background: 'color-mix(in srgb, var(--system-yellow) 40%, transparent)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    background: 'color-mix(in srgb, var(--system-yellow) 85%, transparent)',
    color: '#000',
  },
  '.cm-placeholder': { color: 'var(--label-tertiary)' },

  // ---- live preview ----
  '.cm-md-h1': { fontSize: '1.75em', fontWeight: '700', lineHeight: '1.25', letterSpacing: '-0.02em', paddingTop: '0.5em !important', paddingBottom: '0.15em !important' },
  '.cm-md-h2': { fontSize: '1.4em', fontWeight: '700', lineHeight: '1.3', letterSpacing: '-0.015em', paddingTop: '0.6em !important', paddingBottom: '0.1em !important' },
  '.cm-md-h3': { fontSize: '1.18em', fontWeight: '650', lineHeight: '1.35', paddingTop: '0.5em !important' },
  '.cm-md-h4': { fontSize: '1.05em', fontWeight: '650' },
  '.cm-md-h5': { fontSize: '1em', fontWeight: '650', color: 'var(--label-secondary)' },
  '.cm-md-h6': { fontSize: '0.95em', fontWeight: '650', color: 'var(--label-tertiary)' },
  '.cm-md-quote': {
    borderLeft: '3px solid var(--fill)',
    paddingLeft: '18px !important',
    marginLeft: '28px',
    color: 'var(--label-secondary)',
  },
  '.cm-md-image': {
    display: 'block',
    maxWidth: '100%',
    position: 'relative',
    margin: '0.4em 0',
    padding: '0 28px',
  },
  '.cm-md-image img, .cm-md-image-remote': {
    maxWidth: '100%',
    maxHeight: '480px',
    width: 'auto',
    height: 'auto',
    objectFit: 'contain',
    borderRadius: '10px',
    boxShadow: 'var(--shadow-sm)',
    display: 'block',
  },
  '.cm-md-image-placeholder': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'min(100%, 360px)',
    height: '160px',
    borderRadius: '10px',
    background: 'linear-gradient(90deg, var(--fill-quaternary) 0%, var(--fill-secondary) 50%, var(--fill-quaternary) 100%)',
    backgroundSize: '200% 100%',
    animation: 'cm-md-shimmer 1.1s linear infinite',
    color: 'var(--label-tertiary)',
    fontSize: '1.6em',
  },
  '.cm-md-image-placeholder-icon': { opacity: 0.55, userSelect: 'none' },
  '.cm-md-image-error': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--label-tertiary)',
    fontSize: '0.85em',
    animation: 'none',
    background: 'var(--fill-quaternary)',
  },
  '.cm-md-image-badge': {
    position: 'absolute',
    left: '38px',
    bottom: '14px',
    padding: '2px 8px',
    borderRadius: '6px',
    fontSize: '0.75em',
    color: 'var(--label)',
    background: 'var(--bg-sheet)',
    boxShadow: 'var(--shadow-sm)',
    pointerEvents: 'none',
  },
  '.cm-md-task': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.1em',
    height: '1.1em',
    marginRight: '0.3em',
    verticalAlign: '-0.18em',
    borderRadius: '50%',
    border: '1.5px solid var(--label-tertiary)',
    color: 'var(--accent-contrast)',
    fontSize: '0.72em',
    fontWeight: '700',
    lineHeight: '1',
    cursor: 'pointer',
    transition: 'background-color 120ms, border-color 120ms',
  },
  '.cm-md-bullet': {
    display: 'inline-block',
    width: '0.6em',
    color: 'var(--label-secondary)',
    fontWeight: '700',
  },
  '.cm-md-task-done': { background: 'var(--accent)', borderColor: 'var(--accent)' },
  '.cm-md-code': {
    background: 'var(--bg-code)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.88em',
  },
})

type FormatBinding = { code: string; shift: boolean; alt?: boolean; run: (view: EditorView) => boolean }

/** Formatting keys, matched by physical key so they work on any layout. */
const FORMAT_KEYS: FormatBinding[] = [
  { code: 'KeyB', shift: false, run: toggleWrap('**') },
  { code: 'KeyI', shift: false, run: toggleWrap('*') },
  { code: 'KeyK', shift: false, run: insertLink },
  { code: 'KeyX', shift: true, run: toggleWrap('~~') },
  { code: 'KeyM', shift: true, run: toggleWrap('`') },
  { code: 'KeyC', shift: true, alt: true, run: toggleWrap('`') },
  { code: 'KeyL', shift: true, run: toggleChecklist },
  { code: 'KeyH', shift: true, run: cycleHeading },
]

const formatHandler = EditorView.domEventHandlers({
  keydown(event, view) {
    const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
    if (!mod) return false
    const binding = FORMAT_KEYS.find(
      (b) => b.code === event.code && b.shift === event.shiftKey && Boolean(b.alt) === event.altKey,
    )
    if (!binding) return false
    event.preventDefault()
    return binding.run(view)
  },
})

function imageHandlers() {
  const collectImages = (data: DataTransfer | null): File[] => {
    if (!data) return []
    const fromFiles = Array.from(data.files ?? []).filter(
      (f) => f.type.startsWith('image/') || (!f.type && /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name)),
    )
    if (fromFiles.length > 0) return fromFiles
    const fromItems: File[] = []
    for (const item of Array.from(data.items ?? [])) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) fromItems.push(file)
    }
    return fromItems
  }

  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = collectImages(event.clipboardData)
      if (files.length === 0) return false
      event.preventDefault()
      void insertImageFiles(view, files)
      return true
    },
    drop(event, view) {
      const files = collectImages(event.dataTransfer)
      if (files.length === 0) return false
      event.preventDefault()
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos != null) view.dispatch({ selection: { anchor: pos } })
      void insertImageFiles(view, files)
      return true
    },
  })
}

function buildExtensions() {
  return [
    history(),
    search({ top: true }),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    cmPlaceholder('Start writing…'),
    formatHandler,
    keymap.of([
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...markdownKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorState.allowMultipleSelections.of(true),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
    markdownLivePreview,
    imageHandlers(),
    syntaxHighlighting(highlight, { fallback: true }),
    theme,
    EditorView.lineWrapping,
  ]
}

function contentOf(noteId: number): string | undefined {
  return useEditorStore.getState().pastes.find((p) => p.id === noteId)?.content
}

/**
 * CodeMirror host. It owns its document: keystrokes flow out to the store, and
 * only *external* changes (lazy load, image upload URL swap, duplicate) flow
 * back in via a store subscription — so typing never re-renders React.
 */
function Editor({ noteId, spellcheck }: EditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const noteIdRef = useRef(noteId)

  useEffect(() => {
    if (!containerRef.current) return
    let lastEmitted = contentOf(noteIdRef.current) ?? ''
    let applyingExternal = false

    const view = new EditorView({
      state: EditorState.create({
        doc: lastEmitted,
        extensions: [
          ...buildExtensions(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingExternal) {
              lastEmitted = update.state.doc.toString()
              useEditorStore.getState().setContent(lastEmitted, noteIdRef.current)
            }
          }),
        ],
      }),
      parent: containerRef.current,
    })
    viewRef.current = view
    registerEditor(noteIdRef.current, view)
    void migrateEmbeddedDataUrls(view)

    const unsubscribe = useEditorStore.subscribe((state, prev) => {
      if (state.pastes === prev.pastes) return
      const incoming = state.pastes.find((p) => p.id === noteIdRef.current)?.content
      if (incoming === undefined || incoming === lastEmitted) return
      const current = view.state.doc.toString()
      lastEmitted = incoming
      if (incoming === current) return
      applyingExternal = true
      view.dispatch({ changes: { from: 0, to: current.length, insert: incoming } })
      applyingExternal = false
      void migrateEmbeddedDataUrls(view)
    })

    return () => {
      unsubscribe()
      unregisterEditor(noteIdRef.current, view)
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Temp id → server id swap keeps the same note (and editor); just re-register.
  useEffect(() => {
    const view = viewRef.current
    if (noteIdRef.current === noteId) return
    if (view) unregisterEditor(noteIdRef.current, view)
    noteIdRef.current = noteId
    if (view) registerEditor(noteId, view)
  }, [noteId])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.contentDOM.setAttribute('spellcheck', spellcheck ? 'true' : 'false')
    view.contentDOM.setAttribute('autocapitalize', 'sentences')
  }, [spellcheck])

  return <div ref={containerRef} className={styles.editor} />
}

export default memo(Editor)
