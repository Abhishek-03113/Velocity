import { create } from 'zustand'

export type PreviewView = 'live' | 'pdf'

export interface LatexIssue {
  severity: 'error' | 'warning'
  message: string
  /** Line in the note (already mapped back from the wrapped source). */
  line?: number
}

export interface CompileState {
  status: 'idle' | 'compiling' | 'done' | 'failed' | 'error'
  /** Object URL of the last good PDF; kept while a later compile fails so the view stays useful. */
  pdfUrl: string | null
  pdfBlob: Blob | null
  issues: LatexIssue[]
  log: string
  engine: string | null
  durationMs: number
  /** Transport or set-up problem (no engine, server off), as opposed to TeX errors. */
  error: string | null
  /** Source of the last finished compile, to tell whether the PDF is current. */
  compiledSource: string | null
}

export interface ServerStatus {
  enabled: boolean
  engines: string[]
  defaultEngine: string | null
}

interface LatexState {
  views: Record<number, PreviewView>
  compiles: Record<number, CompileState>
  /** null = not asked yet; 'unreachable' = the request failed. */
  server: ServerStatus | 'unreachable' | null
}

export const EMPTY_COMPILE: CompileState = {
  status: 'idle',
  pdfUrl: null,
  pdfBlob: null,
  issues: [],
  log: '',
  engine: null,
  durationMs: 0,
  error: null,
  compiledSource: null,
}

export const useLatexStore = create<LatexState>(() => ({ views: {}, compiles: {}, server: null }))

export function setView(noteId: number, view: PreviewView) {
  useLatexStore.setState((s) => ({ views: { ...s.views, [noteId]: view } }))
}

export function patchCompile(noteId: number, patch: Partial<CompileState>) {
  useLatexStore.setState((s) => ({
    compiles: { ...s.compiles, [noteId]: { ...(s.compiles[noteId] ?? EMPTY_COMPILE), ...patch } },
  }))
}

export function canCompile(server: LatexState['server']): boolean {
  return server != null && server !== 'unreachable' && server.enabled && server.engines.length > 0
}

/** Drop every PDF object URL (plugin switched off). */
export function resetLatexStore() {
  for (const c of Object.values(useLatexStore.getState().compiles)) if (c.pdfUrl) URL.revokeObjectURL(c.pdfUrl)
  useLatexStore.setState({ views: {}, compiles: {}, server: null })
}
