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
    '.cm-md-image': { display: 'inline-block', maxWidth: '100%' },
    '.cm-md-image img': {
      maxWidth: '100%',
      borderRadius: '10px',
      border: `1px solid ${c.surface0}`,
      display: 'block',
      margin: '0.4em 0',
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
