import { useEffect, useRef, useCallback } from 'react'
import { EditorState, Prec } from '@codemirror/state'
import {
  EditorView,
  keymap,
  highlightActiveLine,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  placeholder as cmPlaceholder,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  indentOnInput,
} from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { useSearchStore } from '../store/searchStore'
import { useEditorStore } from '../store/editorStore'
import { markdownLivePreview, toggleWrap, insertLink } from './markdownRich'
import { insertImageFiles, migrateEmbeddedDataUrls } from '../lib/imageInsert'
import styles from './Editor.module.css'

export type EditorMode = 'plain' | 'markdown'

interface EditorProps {
  content: string | undefined
  onChange: (content: string) => void
  mode: EditorMode
}

// Catppuccin Macchiato
const c = {
  base: '#24273a',
  surface0: '#363a4f',
  surface1: '#494d64',
  overlay0: '#6e738d',
  text: '#cad3f5',
  subtext: '#b8c0e0',
  mauve: '#c6a0f6',
  blue: '#8aadf4',
  sapphire: '#7dc4e4',
  green: '#a6da95',
  yellow: '#eed49f',
  peach: '#f5a97f',
  red: '#ed8796',
  rosewater: '#f4dbd6',
  lavender: '#b7bdf8',
}

const catppuccinHighlight = HighlightStyle.define([
  { tag: t.heading, color: c.mauve, fontWeight: '700' },
  { tag: t.strong, color: c.peach, fontWeight: '700' },
  { tag: t.emphasis, color: c.yellow, fontStyle: 'italic' },
  { tag: t.strikethrough, color: c.overlay0, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: c.blue, textDecoration: 'underline' },
  { tag: [t.monospace, t.literal], color: c.green },
  { tag: t.quote, color: c.subtext, fontStyle: 'italic' },
  { tag: t.list, color: c.sapphire },
  { tag: [t.comment, t.meta], color: c.overlay0 },
  { tag: [t.keyword, t.operator], color: c.mauve },
  { tag: [t.string], color: c.green },
  { tag: [t.number, t.bool], color: c.peach },
  { tag: [t.variableName, t.propertyName], color: c.text },
  { tag: [t.typeName, t.className], color: c.yellow },
  { tag: t.invalid, color: c.red },
])

const catppuccinTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      width: '100%',
      fontSize: '15.5px',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      background: c.base,
      color: c.text,
    },
    '.cm-scroller': {
      overflow: 'auto',
      lineHeight: '1.8',
      letterSpacing: '0.01em',
      fontFamily: 'inherit',
    },
    '.cm-content': {
      padding: '28px 0 45vh',
      caretColor: c.rosewater,
      maxWidth: '860px',
      margin: '0 auto',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-line': { padding: '0 8px' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeft: `2px solid ${c.rosewater}`,
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      background: `${c.surface1} !important`,
    },
    '.cm-activeLine': { background: 'rgba(255,255,255,0.025)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      background: c.surface1,
      color: c.rosewater,
      outline: 'none',
    },
    '.cm-searchMatch': { background: 'rgba(198,160,246,0.25)' },
    '.cm-searchMatch.cm-searchMatch-selected': { background: 'rgba(238,212,159,0.4)' },
    '.cm-placeholder': { color: c.overlay0, fontStyle: 'italic' },

    // ---- live preview ----
    '.cm-md-h1': { fontSize: '1.9em', fontWeight: '700', lineHeight: '1.3', color: c.mauve, margin: '0.6em 0 0.2em' },
    '.cm-md-h2': { fontSize: '1.55em', fontWeight: '700', lineHeight: '1.35', color: c.mauve, margin: '0.55em 0 0.2em' },
    '.cm-md-h3': { fontSize: '1.3em', fontWeight: '700', lineHeight: '1.4', color: c.lavender, margin: '0.5em 0 0.2em' },
    '.cm-md-h4': { fontSize: '1.15em', fontWeight: '600', color: c.lavender },
    '.cm-md-h5': { fontSize: '1.05em', fontWeight: '600', color: c.subtext },
    '.cm-md-h6': { fontSize: '1em', fontWeight: '600', color: c.overlay0 },
    '.cm-md-image': {
      display: 'inline-block',
      maxWidth: '100%',
      position: 'relative',
    },
    '.cm-md-image img, .cm-md-image-preview': {
      maxWidth: '100%',
      maxHeight: '480px',
      width: 'auto',
      height: 'auto',
      objectFit: 'contain',
      borderRadius: '10px',
      border: `1px solid ${c.surface0}`,
      display: 'block',
      margin: '0.4em 0',
    },
    '.cm-md-image-preview': {
      opacity: 0.55,
      filter: 'saturate(0.85)',
    },
    '.cm-md-image-placeholder': {
      display: 'block',
      width: 'min(100%, 320px)',
      height: '160px',
      margin: '0.4em 0',
      borderRadius: '10px',
      border: `1px solid ${c.surface0}`,
      background: `linear-gradient(90deg, ${c.surface0} 0%, ${c.surface1} 50%, ${c.surface0} 100%)`,
      backgroundSize: '200% 100%',
      animation: 'cm-md-shimmer 1.1s linear infinite',
    },
    '.cm-md-image-error': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: c.overlay0,
      fontSize: '0.85em',
      fontStyle: 'italic',
      animation: 'none',
      background: c.surface0,
    },
    '.cm-md-image-badge': {
      position: 'absolute',
      left: '10px',
      bottom: '14px',
      padding: '2px 8px',
      borderRadius: '6px',
      fontSize: '0.75em',
      letterSpacing: '0.02em',
      color: c.text,
      background: 'rgba(36, 39, 58, 0.85)',
      border: `1px solid ${c.surface1}`,
      pointerEvents: 'none',
    },
    '.cm-md-task': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '1.05em',
      height: '1.05em',
      marginRight: '0.15em',
      verticalAlign: '-0.15em',
      borderRadius: '4px',
      border: `1.5px solid ${c.overlay0}`,
      color: c.base,
      fontSize: '0.8em',
      lineHeight: '1',
      cursor: 'pointer',
    },
    '.cm-md-code': {
      background: 'rgba(24,25,38,0.6)',
      fontSize: '0.94em',
    },
    '.cm-md-task-done': { background: c.green, borderColor: c.green },
  },
  { dark: true },
)

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
      // markdown formatting
      { key: 'Mod-b', run: toggleWrap('**') },
      { key: 'Mod-i', run: toggleWrap('*') },
      { key: 'Mod-Shift-x', run: toggleWrap('~~') },
      { key: 'Mod-Shift-c', run: toggleWrap('`') },
      { key: 'Mod-k', run: insertLink },
    ])
  )
}

function buildImageHandlers() {
  const collectImages = (data: DataTransfer | null): File[] => {
    if (!data) return []
    const fromFiles = Array.from(data.files ?? []).filter((f) =>
      f.type.startsWith('image/') || (!f.type && /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name)),
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
      if (pos != null) {
        view.dispatch({ selection: { anchor: pos } })
      }
      void insertImageFiles(view, files)
      return true
    },
  })
}

function buildExtensions(mode: EditorMode) {
  const isMarkdown = mode === 'markdown'
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
    keymap.of([
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...(isMarkdown ? markdownKeymap : []),
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    highlightActiveLine(),
    EditorState.allowMultipleSelections.of(true),
    ...(isMarkdown
      ? [
          markdown({
            base: markdownLanguage,
            codeLanguages: languages,
            addKeymap: false,
          }),
          markdownLivePreview,
          buildImageHandlers(),
        ]
      : []),
    syntaxHighlighting(catppuccinHighlight, { fallback: true }),
    catppuccinTheme,
    EditorView.lineWrapping,
    buildAppKeybindings(),
  ]
}


export default function Editor({ content, onChange, mode }: EditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const applyingExternalChangeRef = useRef(false)
  /** Last doc string we pushed to Zustand — ignore stale prop echoes. */
  const lastEmittedRef = useRef<string | null>(null)
  onChangeRef.current = onChange

  const stableOnChange = useCallback((val: string) => {
    lastEmittedRef.current = val
    onChangeRef.current(val)
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    lastEmittedRef.current = content ?? ''
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
    void migrateEmbeddedDataUrls(view)

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
    const incoming = content ?? ''
    const current = view.state.doc.toString()

    // Already in sync, or React echoed the doc we just pushed to Zustand.
    if (incoming === current || incoming === lastEmittedRef.current) {
      lastEmittedRef.current = incoming
      return
    }

    // Editor already shows our latest emit while props disagree → stale echo
    // (e.g. pending image URL after upload swapped to /api/assets/...).
    // Must NOT block empty→loaded: lazy fetch mounts with '' then fills content.
    if (current.length > 0 && current === lastEmittedRef.current) return

    applyingExternalChangeRef.current = true
    view.dispatch({
      changes: { from: 0, to: current.length, insert: incoming },
    })
    applyingExternalChangeRef.current = false
    lastEmittedRef.current = incoming
    void migrateEmbeddedDataUrls(view)
  }, [content])

  return <div ref={containerRef} className={styles.editor} />
}
