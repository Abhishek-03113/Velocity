import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { ServerPlugin } from '../types.ts'
import { compileEnabled, compileLatex, CompileBusyError, defaultEngine, ENGINES, findEngines } from './compile.ts'
import type { LatexIssue } from './log.ts'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

const MAX_SOURCE = 2 * 1024 * 1024

const compileSchema = z.object({
  source: z.string().min(1, 'source is required').max(MAX_SOURCE, 'The document is over 2 MB'),
  engine: z.enum(ENGINES).optional(),
})

export interface LatexStatus {
  enabled: boolean
  engines: string[]
  defaultEngine: string | null
}

export interface CompileResponse {
  ok: boolean
  engine: string
  /** Base64 PDF, or null when compilation failed. */
  pdf: string | null
  log: string
  issues: LatexIssue[]
  durationMs: number
  timedOut: boolean
}

const NO_ENGINE =
  'No TeX engine found on the server. Install TeX Live, MiKTeX or Tectonic so latexmk, pdflatex, xelatex, lualatex or tectonic is on PATH (or set LATEX_BIN_DIR).'

const router = new Hono()

router.get('/status', async (c) => {
  const found = await findEngines()
  return c.json<ApiResponse<LatexStatus>>({
    success: true,
    data: { enabled: compileEnabled(), engines: [...found.keys()], defaultEngine: defaultEngine(found) },
  })
})

// Transport only: the TeX engine is the one thing the browser can't run. The source comes
// from the note; nothing is stored.
router.post(
  '/compile',
  bodyLimit({
    maxSize: MAX_SOURCE * 2,
    onError: (c) => c.json<ApiResponse<never>>({ success: false, error: 'The document is over 2 MB' }, 413),
  }),
  async (c) => {
    if (!compileEnabled()) {
      return c.json<ApiResponse<never>>({ success: false, error: 'LaTeX compilation is off on this server (LATEX_COMPILE=off)' }, 503)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json<ApiResponse<never>>({ success: false, error: 'Expected a JSON body' }, 400)
    }
    const parsed = compileSchema.safeParse(body)
    if (!parsed.success) {
      return c.json<ApiResponse<never>>({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' }, 400)
    }
    const found = await findEngines()
    const engine = parsed.data.engine ?? defaultEngine(found)
    if (!engine) return c.json<ApiResponse<never>>({ success: false, error: NO_ENGINE }, 503)
    const bin = found.get(engine)
    if (!bin) {
      const list = [...found.keys()].join(', ') || 'none'
      return c.json<ApiResponse<never>>({ success: false, error: `${engine} is not installed on the server (found: ${list})` }, 400)
    }
    try {
      const result = await compileLatex(parsed.data.source, engine, bin)
      if (!result.ok) console.warn(`[latex] ${engine} failed after ${result.durationMs} ms`)
      return c.json<ApiResponse<CompileResponse>>({
        success: true,
        data: {
          ok: result.ok,
          engine: result.engine,
          pdf: result.pdf ? result.pdf.toString('base64') : null,
          log: result.log,
          issues: result.issues,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
        },
      })
    } catch (err) {
      if (err instanceof CompileBusyError) return c.json<ApiResponse<never>>({ success: false, error: err.message }, 429)
      throw err
    }
  },
)

export const latexPlugin: ServerPlugin = { id: 'latex', name: 'LaTeX', router }
