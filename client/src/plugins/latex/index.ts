import { StreamLanguage, type StreamParser } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { createElement, lazy, Suspense } from 'react'
import { apiBaseUrl } from '../../lib/api'
import { useEditorStore } from '../../store/editorStore'
import { cachedContent } from '../../store/searchStore'
import type { NoteBadge, PluginContext, VelocityPlugin } from '../types'
import { base64ToBytes, exportName, isLatexSource, newDocumentTemplate, standaloneSource } from './document'
import type { LatexActions } from './LatexPreview'
import { canCompile, patchCompile, resetLatexStore, setView, useLatexStore, type ServerStatus } from './store'

// KaTeX, the renderer and the tile UI load only when a preview is first shown.
const LatexPreview = lazy(() => import('./LatexPreview'))

const VIEW = 'preview'
const KEYS = { preview: 'Ctrl+Alt+KeyX', compile: 'Ctrl+Alt+Shift+KeyX' } as const

interface CompileResponse {
  ok: boolean
  engine: string
  pdf: string | null
  log: string
  issues: { severity: 'error' | 'warning'; message: string; line?: number }[]
  durationMs: number
  timedOut: boolean
}

const plugin: VelocityPlugin = {
  manifest: {
    id: 'latex',
    name: 'LaTeX',
    description: 'Write LaTeX in a note with a live preview tile beside it, compile to PDF, and export .tex or PDF.',
    icon: 'sum',
    version: '1.0.0',
  },
  settings: [
    {
      key: 'engine',
      type: 'choice',
      label: 'TeX engine',
      hint: 'Used to compile on the Velocity server. Auto picks LATEX_ENGINE, else the first one installed.',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'latexmk', label: 'latexmk' },
        { value: 'pdflatex', label: 'pdfLaTeX' },
        { value: 'xelatex', label: 'XeLaTeX' },
        { value: 'lualatex', label: 'LuaLaTeX' },
        { value: 'tectonic', label: 'Tectonic' },
      ],
    },
    {
      key: 'autoCompile',
      type: 'toggle',
      label: 'Recompile as you type',
      hint: 'While the tile shows the PDF, compile again a moment after you stop typing.',
      default: true,
    },
    { key: 'folder', type: 'text', label: 'Folder for new documents', default: 'LaTeX', placeholder: 'LaTeX' },
    {
      key: 'badges',
      type: 'toggle',
      label: 'Mark LaTeX notes',
      hint: 'A TeX pill in the notes list on notes that start a LaTeX document; click it to show the preview.',
      default: true,
    },
  ],

  activate(ctx: PluginContext) {
    let serverRequest: Promise<void> | null = null
    const checkServer = (force = false) => {
      if (serverRequest && !force) return serverRequest
      serverRequest = ctx.api
        .get<ServerStatus>('/status')
        .then((status) => useLatexStore.setState({ server: status }))
        .catch((err) => {
          console.error('[latex] status failed:', err)
          useLatexStore.setState({ server: 'unreachable' })
        })
      return serverRequest
    }

    /** Notes previewed this session count as LaTeX even when they are fragments. */
    const previewed = new Set<number>()
    const contentOf = (id: number) => useEditorStore.getState().pastes.find((p) => p.id === id)?.content ?? cachedContent(id)
    const detected = new Map<number, { content: string; latex: boolean }>()
    const isLatexNote = (id: number) => {
      if (previewed.has(id)) return true
      const content = contentOf(id)
      if (content == null) return false
      const memo = detected.get(id)
      if (memo?.content === content) return memo.latex
      const latex = isLatexSource(content.slice(0, 4000))
      detected.set(id, { content, latex })
      return latex
    }

    const currentNote = () => {
      const id = ctx.notes.current()
      if (id == null) ctx.flash('Open a note first')
      return id
    }

    const openPreview = (noteId: number, opts: { focus?: boolean } = {}) => {
      previewed.add(noteId)
      ctx.refreshBadges()
      ctx.tiles.open(VIEW, noteId, { focus: opts.focus ?? false })
    }

    const togglePreview = (noteId: number) => {
      if (ctx.tiles.isOpen(VIEW, noteId)) ctx.tiles.close(VIEW, noteId)
      else openPreview(noteId)
    }

    /** Compile on the server. Resolves with the PDF when it built. */
    const compile = async (noteId: number): Promise<Blob | null> => {
      const state = useLatexStore.getState()
      if (state.compiles[noteId]?.status === 'compiling') return null
      await checkServer()
      const server = useLatexStore.getState().server
      if (!canCompile(server)) {
        patchCompile(noteId, {
          status: 'error',
          error:
            server === 'unreachable'
              ? 'The Velocity server could not be reached.'
              : server?.enabled === false
                ? 'Compiling is switched off on this server (LATEX_COMPILE=off).'
                : 'No TeX engine on the server.',
        })
        return null
      }
      const { source, lineOffset } = standaloneSource(await ctx.notes.content(noteId))
      const engine = ctx.setting<string>('engine')
      patchCompile(noteId, { status: 'compiling', error: null })
      ctx.activity('Compiling LaTeX…')
      try {
        const res = await ctx.api.post<CompileResponse>('/compile', {
          source,
          engine: engine === 'auto' ? undefined : engine,
        })
        const issues = res.issues.map((i) => {
          if (i.line == null) return i
          const line = i.line - lineOffset
          return line >= 1 ? { ...i, line } : { severity: i.severity, message: i.message }
        })
        const previous = useLatexStore.getState().compiles[noteId]
        let pdfBlob: Blob | null = null
        let pdfUrl = previous?.pdfUrl ?? null
        if (res.pdf) {
          pdfBlob = new Blob([base64ToBytes(res.pdf)], { type: 'application/pdf' })
          if (pdfUrl) URL.revokeObjectURL(pdfUrl)
          pdfUrl = URL.createObjectURL(pdfBlob)
        }
        patchCompile(noteId, {
          status: res.ok ? 'done' : 'failed',
          pdfBlob: pdfBlob ?? previous?.pdfBlob ?? null,
          pdfUrl,
          issues,
          log: res.log,
          engine: res.engine,
          durationMs: res.durationMs,
          compiledSource: source,
          error: null,
        })
        return res.ok ? pdfBlob : null
      } catch (err) {
        const status = (err as { status?: number }).status
        if (status === 503) void checkServer(true)
        patchCompile(noteId, { status: 'error', error: err instanceof Error ? err.message : String(err) })
        return null
      } finally {
        ctx.activity(null)
      }
    }

    const compileAndShow = (noteId: number) => {
      openPreview(noteId)
      setView(noteId, 'pdf')
      void compile(noteId)
    }

    const exportTex = async (noteId: number) => {
      const { source, wrapped } = standaloneSource(await ctx.notes.content(noteId))
      ctx.files.download(exportName(ctx.notes.title(noteId), 'tex'), source, 'application/x-tex;charset=utf-8')
      ctx.flash(wrapped ? 'Exported .tex (wrapped in an article preamble)' : 'Exported .tex')
    }

    const renderedHtml = async (noteId: number) => {
      const [{ renderLatex }, { renderMath }] = await Promise.all([import('./render'), import('./math')])
      return renderLatex(await ctx.notes.content(noteId), { math: renderMath, resolveImage })
    }

    const exportPdf = async (noteId: number) => {
      await checkServer()
      const name = exportName(ctx.notes.title(noteId), 'pdf')
      if (canCompile(useLatexStore.getState().server)) {
        const current = useLatexStore.getState().compiles[noteId]
        const { source } = standaloneSource(await ctx.notes.content(noteId))
        const blob = current?.status === 'done' && current.compiledSource === source && current.pdfBlob ? current.pdfBlob : await compile(noteId)
        if (blob) {
          ctx.files.download(name, blob)
          ctx.flash(`Exported ${name}`)
        } else {
          openPreview(noteId)
          setView(noteId, 'pdf')
          ctx.flash('Couldn’t compile — see the LaTeX tile')
        }
        return
      }
      // No TeX engine: print the live preview (the browser offers "Save as PDF").
      const { printPreview } = await import('./paper')
      const rendered = await renderedHtml(noteId)
      printPreview(rendered.html, rendered.title ?? ctx.notes.title(noteId))
      ctx.flash('No TeX engine on the server — printing the live preview instead')
    }

    const resolveImage = (path: string): string | null => {
      const p = path.trim()
      if (/^https?:\/\//i.test(p)) return p
      if (p.startsWith('/api/assets/')) return `${apiBaseUrl()}${p}`
      return null
    }

    const actions: LatexActions = {
      useContent: (noteId) => ctx.notes.useContent(noteId),
      ensureContent: (noteId) => void ctx.notes.content(noteId),
      compile: (noteId) => void compile(noteId),
      exportTex: (noteId) => void exportTex(noteId),
      exportPdf: (noteId) => void exportPdf(noteId),
      goToLine: (noteId, line) => ctx.notes.goToLine(noteId, line),
      resolveImage,
      autoCompile: () => ctx.setting<boolean>('autoCompile'),
      checkServer: () => void checkServer(),
      shortcut: (command) => KEYS[command],
    }

    const withNote = (fn: (id: number) => void) => () => {
      const id = currentNote()
      if (id != null) fn(id)
    }

    return {
      commands: [
        {
          id: 'new',
          title: 'New LaTeX Document',
          keywords: 'tex latex paper article create',
          run: () => {
            const id = ctx.notes.create({
              title: 'Untitled Document',
              content: newDocumentTemplate('Untitled Document', ''),
              folder: ctx.setting<string>('folder').trim() || undefined,
            })
            openPreview(id)
          },
        },
        {
          id: 'preview',
          title: 'Toggle Live Preview',
          keys: [KEYS.preview],
          keywords: 'tex latex preview render tile side by side',
          run: withNote(togglePreview),
        },
        {
          id: 'compile',
          title: 'Compile to PDF',
          keys: [KEYS.compile],
          keywords: 'tex latex pdflatex xelatex build typeset',
          run: withNote(compileAndShow),
        },
        { id: 'export-tex', title: 'Export as .tex', keywords: 'tex latex download save file', run: withNote((id) => void exportTex(id)) },
        { id: 'export-pdf', title: 'Export as PDF', keywords: 'tex latex download save print', run: withNote((id) => void exportPdf(id)) },
      ],
      // LaTeX source is edited as LaTeX (highlighted commands, maths and comments), not as rich Markdown.
      editorMode: {
        matches: isLatexSource,
        // legacy-modes types its parsers with @codemirror/streamparser's copy of StreamParser;
        // the shapes are identical at runtime.
        extensions: () => StreamLanguage.define(stex as unknown as StreamParser<unknown>),
      },
      tiles: {
        [VIEW]: {
          title: 'LaTeX Preview',
          icon: 'sum',
          render: (noteId) =>
            createElement(
              Suspense,
              { fallback: createElement('div', { style: { padding: 24, color: 'var(--label-tertiary)' } }, 'Loading preview…') },
              createElement(LatexPreview, { noteId, actions }),
            ),
        },
      },
      noteBadge: (noteId): NoteBadge | null => {
        if (!ctx.setting<boolean>('badges') || !isLatexNote(noteId)) return null
        return { label: 'TeX', tone: 'teal', title: 'Toggle LaTeX preview', onClick: () => togglePreview(noteId) }
      },
      dispose: () => {
        resetLatexStore()
        detected.clear()
      },
    }
  },
}

export default plugin
