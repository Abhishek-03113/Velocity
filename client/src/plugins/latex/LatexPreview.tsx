import { useDeferredValue, useEffect, useMemo, useRef } from 'react'
import { Icon } from '../../components/Icon'
import { Segmented } from '../../components/ui/Segmented'
import { ToolbarButton } from '../../components/ui/ToolbarButton'
import { renderMath } from './math'
import { ensurePreviewStyles } from './paper'
import { renderLatex } from './render'
import { standaloneSource } from './document'
import { canCompile, EMPTY_COMPILE, setView, useLatexStore, type LatexIssue, type PreviewView } from './store'
import styles from './LatexPreview.module.css'

export interface LatexActions {
  useContent(noteId: number): string | undefined
  ensureContent(noteId: number): void
  compile(noteId: number): void
  exportTex(noteId: number): void
  exportPdf(noteId: number): void
  goToLine(noteId: number, line: number): void
  resolveImage(path: string): string | null
  autoCompile(): boolean
  checkServer(): void
  shortcut(command: 'preview' | 'compile'): string | undefined
}

const AUTO_COMPILE_MS = 1500
/** False in browsers without a built-in PDF viewer (and in headless Chromium). */
const INLINE_PDF = typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false

export default function LatexPreview({ noteId, actions }: { noteId: number; actions: LatexActions }) {
  const content = actions.useContent(noteId)
  const view = useLatexStore((s) => s.views[noteId] ?? 'live')
  const compile = useLatexStore((s) => s.compiles[noteId] ?? EMPTY_COMPILE)
  const server = useLatexStore((s) => s.server)

  useEffect(() => {
    ensurePreviewStyles()
    actions.ensureContent(noteId)
    actions.checkServer()
  }, [actions, noteId])

  // Typing stays responsive: the preview renders a deferred copy of the source.
  const deferred = useDeferredValue(content ?? '')
  const rendered = useMemo(
    () => renderLatex(deferred, { math: renderMath, resolveImage: actions.resolveImage }),
    [deferred, actions],
  )

  // Auto-compile while the PDF view is showing, once typing pauses.
  const source = useMemo(() => (content == null ? null : standaloneSource(content).source), [content])
  const stale = source != null && compile.compiledSource !== source
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (view !== 'pdf' || !stale || compile.status === 'compiling' || !canCompile(server) || !actions.autoCompile()) return
    autoTimer.current = setTimeout(() => actions.compile(noteId), AUTO_COMPILE_MS)
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current)
    }
  }, [view, stale, source, compile.status, server, actions, noteId])

  const compilable = canCompile(server)
  const errors = compile.issues.filter((i) => i.severity === 'error').length
  const warnings = compile.issues.length - errors

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <Segmented<PreviewView>
          size="small"
          label="Preview"
          value={view}
          onChange={(v) => setView(noteId, v)}
          options={[
            { value: 'live', label: 'Live', title: 'Instant HTML preview' },
            { value: 'pdf', label: 'PDF', title: 'Compiled with the server’s TeX engine' },
          ]}
        />
        <span className={styles.status} aria-live="polite">
          {view === 'live' ? liveStatus(rendered.unsupported) : pdfStatus(compile, compilable, stale, errors, warnings)}
        </span>
        <span className={styles.spacer} />
        <ToolbarButton
          size="small"
          icon="arrow.triangle.2.circlepath"
          label={compile.status === 'compiling' ? 'Compiling…' : 'Compile to PDF'}
          shortcut={actions.shortcut('compile')}
          disabled={compile.status === 'compiling' || server === null}
          onClick={() => {
            setView(noteId, 'pdf')
            actions.compile(noteId)
          }}
        />
        <ToolbarButton size="small" icon="doc.text" label="Export .tex" onClick={() => actions.exportTex(noteId)} />
        <ToolbarButton
          size="small"
          icon="square.and.arrow.down"
          label={compilable ? 'Export PDF' : 'Export PDF (print the live preview)'}
          onClick={() => actions.exportPdf(noteId)}
        />
      </div>

      {view === 'live' ? (
        <div className={styles.scroll}>
          {content === undefined ? (
            <div className={styles.placeholder}>Loading…</div>
          ) : content.trim() === '' ? (
            <div className={styles.placeholder}>Start typing LaTeX in the note — the preview follows as you type.</div>
          ) : (
            <article className="ltx-page" dangerouslySetInnerHTML={{ __html: rendered.html }} />
          )}
        </div>
      ) : (
        <PdfPane noteId={noteId} actions={actions} compilable={compilable} />
      )}
    </div>
  )
}

function PdfPane({ noteId, actions, compilable }: { noteId: number; actions: LatexActions; compilable: boolean }) {
  const compile = useLatexStore((s) => s.compiles[noteId] ?? EMPTY_COMPILE)
  const server = useLatexStore((s) => s.server)
  const showIssues = compile.issues.length > 0 || compile.error

  if (!compilable && !compile.pdfUrl) {
    return (
      <div className={styles.empty}>
        <Icon name="exclamationmark.triangle" size={22} />
        <p className={styles.emptyTitle}>{server === null ? 'Checking the server…' : 'No TeX engine on the server'}</p>
        {server !== null && (
          <p className={styles.emptyText}>
            {server === 'unreachable'
              ? 'The Velocity server could not be reached.'
              : server.enabled
                ? 'Install TeX Live, MiKTeX or Tectonic on the Velocity server (latexmk, pdflatex, xelatex, lualatex or tectonic on PATH), then compile again. The live preview and “Export PDF” (print) work without it.'
                : 'Compiling is switched off on this server (LATEX_COMPILE=off).'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={styles.pdfPane}>
      {showIssues && (
        <ul className={styles.issues} aria-label="TeX messages">
          {compile.error && (
            <li className={styles.issueError}>
              <Icon name="exclamationmark.triangle" size={13} />
              <span>{compile.error}</span>
            </li>
          )}
          {compile.issues.map((issue, n) => (
            <IssueRow key={n} issue={issue} onGo={(line) => actions.goToLine(noteId, line)} />
          ))}
          {compile.log && (
            <li className={styles.logRow}>
              <details>
                <summary>Full log</summary>
                <pre className={styles.log}>{compile.log}</pre>
              </details>
            </li>
          )}
        </ul>
      )}
      {compile.pdfUrl && INLINE_PDF ? (
        <iframe className={styles.pdf} src={compile.pdfUrl} title="Compiled PDF" />
      ) : compile.pdfUrl ? (
        // Without a built-in PDF viewer an iframe would download the file on every compile.
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>
            {compile.status === 'compiling' ? 'Compiling…' : 'Compiled — this browser can’t show PDFs inline'}
          </p>
          <a className={styles.primary} href={compile.pdfUrl} target="_blank" rel="noopener noreferrer">
            Open PDF
          </a>
        </div>
      ) : (
        <div className={styles.empty}>
          {compile.status === 'compiling' ? (
            <p className={styles.emptyTitle}>Compiling…</p>
          ) : compile.status === 'idle' ? (
            <>
              <p className={styles.emptyTitle}>Not compiled yet</p>
              <button type="button" className={styles.primary} onClick={() => actions.compile(noteId)}>
                Compile to PDF
              </button>
            </>
          ) : (
            <p className={styles.emptyTitle}>No PDF — fix the errors above and compile again.</p>
          )}
        </div>
      )}
    </div>
  )
}

function IssueRow({ issue, onGo }: { issue: LatexIssue; onGo: (line: number) => void }) {
  const cls = issue.severity === 'error' ? styles.issueError : styles.issueWarning
  const body = (
    <>
      <span className={styles.issueKind}>{issue.severity === 'error' ? 'Error' : 'Warning'}</span>
      {issue.line != null && <span className={styles.issueLine}>line {issue.line}</span>}
      <span className={styles.issueText}>{issue.message}</span>
    </>
  )
  return (
    <li className={cls}>
      {issue.line != null ? (
        <button type="button" className={styles.issueButton} onClick={() => onGo(issue.line!)} title="Show this line in the note">
          {body}
        </button>
      ) : (
        <span className={styles.issueButton}>{body}</span>
      )}
    </li>
  )
}

function liveStatus(unsupported: string[]): string {
  if (!unsupported.length) return 'Live preview'
  const list = unsupported.slice(0, 3).join(', ')
  return `Live preview · not shown: ${list}${unsupported.length > 3 ? ` +${unsupported.length - 3}` : ''}`
}

function pdfStatus(
  c: typeof EMPTY_COMPILE,
  compilable: boolean,
  stale: boolean,
  errors: number,
  warnings: number,
): string {
  if (c.status === 'compiling') return 'Compiling…'
  if (c.status === 'error') return c.error ?? 'Couldn’t compile'
  if (c.status === 'idle') return compilable ? 'Not compiled yet' : ''
  const counts = [errors && `${errors} error${errors > 1 ? 's' : ''}`, warnings && `${warnings} warning${warnings > 1 ? 's' : ''}`]
    .filter(Boolean)
    .join(', ')
  const head = c.status === 'done' ? `${c.engine} · ${(c.durationMs / 1000).toFixed(1)} s` : `${c.engine} failed`
  return [head, counts, stale && c.status === 'done' ? 'edited since' : ''].filter(Boolean).join(' · ')
}
