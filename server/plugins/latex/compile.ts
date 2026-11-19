/**
 * Runs a TeX engine that is installed on the server (TeX Live, MiKTeX or Tectonic) on one
 * document, in a fresh temporary folder that is deleted afterwards.
 *
 * Hardening: shell escape is off for every engine, kpathsea is set to "paranoid" for reads
 * and writes (no absolute paths, no `..`, no dot files), latexmk ignores rc files, Tectonic
 * runs with `--untrusted`, and every run has a time and output cap. Nothing is kept on disk.
 */
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { needsRerun, parseLatexLog, type LatexIssue } from './log.ts'

export const ENGINES = ['latexmk', 'pdflatex', 'xelatex', 'lualatex', 'tectonic'] as const
export type Engine = (typeof ENGINES)[number]

export interface CompileResult {
  ok: boolean
  engine: Engine
  pdf: Buffer | null
  log: string
  issues: LatexIssue[]
  durationMs: number
  timedOut: boolean
}

export class CompileBusyError extends Error {
  constructor() {
    super('The server is already compiling several documents. Try again in a moment.')
    this.name = 'CompileBusyError'
  }
}

const MAX_LOG_CHARS = 200_000
const MAX_PASSES = 3
const ENGINE_CACHE_MS = 30_000

const numberEnv = (name: string, fallback: number) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const compileEnabled = () => process.env.LATEX_COMPILE !== 'off'
const timeoutMs = () => numberEnv('LATEX_TIMEOUT_MS', 30_000)
const maxPdfBytes = () => numberEnv('LATEX_MAX_PDF_BYTES', 20 * 1024 * 1024)
const maxConcurrent = () => numberEnv('LATEX_MAX_CONCURRENT', 2)
const MAX_QUEUED = 8

function searchDirs(): string[] {
  const extra = process.env.LATEX_BIN_DIR ? process.env.LATEX_BIN_DIR.split(path.delimiter) : []
  return [...extra, ...(process.env.PATH ?? '').split(path.delimiter)].filter(Boolean)
}

async function findBinary(name: string): Promise<string | null> {
  const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name]
  for (const dir of searchDirs()) {
    for (const n of names) {
      const candidate = path.join(dir, n)
      try {
        await access(candidate, constants.X_OK)
        if ((await stat(candidate)).isFile()) return candidate
      } catch {
        // not here
      }
    }
  }
  return null
}

let engineCache: { at: number; found: Map<Engine, string> } | null = null

/** Engines found on the server, in preference order, with their binary paths. */
export async function findEngines(): Promise<Map<Engine, string>> {
  if (engineCache && Date.now() - engineCache.at < ENGINE_CACHE_MS) return engineCache.found
  const found = new Map<Engine, string>()
  for (const engine of ENGINES) {
    const bin = await findBinary(engine)
    if (bin) found.set(engine, bin)
  }
  engineCache = { at: Date.now(), found }
  return found
}

/** For tests (and after installing TeX while the server runs). */
export function resetEngineCache() {
  engineCache = null
}

/** `LATEX_ENGINE` when it is installed, else the first engine found. */
export function defaultEngine(found: Map<Engine, string>): Engine | null {
  const preferred = process.env.LATEX_ENGINE as Engine | undefined
  if (preferred && found.has(preferred)) return preferred
  return found.keys().next().value ?? null
}

function argsFor(engine: Engine, dir: string): string[] {
  const tex = ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-no-shell-escape']
  switch (engine) {
    case 'tectonic':
      return ['--untrusted', '--keep-logs', '--chatter', 'minimal', '--outdir', dir, 'main.tex']
    case 'latexmk':
      // latexmk does its own reruns (and bibtex/biber when needed).
      return ['-norc', '-pdf', ...tex, 'main.tex']
    default:
      return [...tex, 'main.tex']
  }
}

interface Run {
  code: number | null
  output: string
  timedOut: boolean
}

function run(bin: string, args: string[], cwd: string, budgetMs: number): Promise<Run> {
  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    const child = spawn(bin, args, {
      cwd,
      // Own process group, so a timeout kills latexmk's children too.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        openin_any: 'p',
        openout_any: 'p',
        shell_escape: 'f',
        TEXMFOUTPUT: cwd,
        max_print_line: '10000',
      },
    })
    const collect = (chunk: Buffer) => {
      if (output.length < MAX_LOG_CHARS) output += chunk.toString('utf8')
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const kill = () => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        // already gone
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, Math.max(1, budgetMs))
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: null, output: output + `\n${err.message}`, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output, timedOut })
    })
  })
}

async function readIfExists(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file)
  } catch {
    return null
  }
}

function tail(text: string, max = MAX_LOG_CHARS): string {
  return text.length <= max ? text : `[… ${text.length - max} characters cut …]\n` + text.slice(-max)
}

async function compileNow(source: string, engine: Engine, bin: string): Promise<CompileResult> {
  const started = Date.now()
  const dir = await mkdtemp(path.join(os.tmpdir(), 'velocity-latex-'))
  try {
    await writeFile(path.join(dir, 'main.tex'), source, 'utf8')
    const deadline = started + timeoutMs()
    const passes = engine === 'latexmk' || engine === 'tectonic' ? 1 : MAX_PASSES
    let last: Run = { code: null, output: '', timedOut: false }
    let log = ''
    for (let pass = 0; pass < passes; pass++) {
      last = await run(bin, argsFor(engine, dir), dir, deadline - Date.now())
      log = (await readIfExists(path.join(dir, 'main.log')))?.toString('utf8') ?? last.output
      if (last.timedOut || last.code !== 0 || !needsRerun(log)) break
    }
    let pdf = last.code === 0 && !last.timedOut ? await readIfExists(path.join(dir, 'main.pdf')) : null
    let note = ''
    if (pdf && pdf.length > maxPdfBytes()) {
      note = `\nThe PDF is ${pdf.length} bytes, over the server's limit of ${maxPdfBytes()} (LATEX_MAX_PDF_BYTES).`
      pdf = null
    }
    if (last.timedOut) note += `\nStopped after ${timeoutMs()} ms (LATEX_TIMEOUT_MS).`
    if (!log.trim() && last.output.trim()) log = last.output
    const fullLog = tail(log + note)
    const issues = parseLatexLog(fullLog)
    if (!pdf && !issues.some((i) => i.severity === 'error')) {
      issues.unshift({
        severity: 'error',
        message: last.timedOut ? 'Compilation timed out.' : note.trim() || `${engine} did not produce a PDF.`,
      })
    }
    return { ok: pdf != null, engine, pdf, log: fullLog, issues, durationMs: Date.now() - started, timedOut: last.timedOut }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

let running = 0
const waiting: (() => void)[] = []

/** Compile with at most `LATEX_MAX_CONCURRENT` engines running; throws CompileBusyError when the queue is full. */
export async function compileLatex(source: string, engine: Engine, bin: string): Promise<CompileResult> {
  if (running < maxConcurrent()) running++
  else {
    if (waiting.length >= MAX_QUEUED) throw new CompileBusyError()
    // The finishing compile hands its slot straight to us, so `running` stays put.
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  try {
    return await compileNow(source, engine, bin)
  } finally {
    const next = waiting.shift()
    if (next) next()
    else running--
  }
}
