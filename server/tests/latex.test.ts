import { TEST_ROOT } from './setup.ts'
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { createApp } = await import('../app.ts')
const { resetEngineCache } = await import('../plugins/latex/compile.ts')
const { parseLatexLog, needsRerun } = await import('../plugins/latex/log.ts')
const app = createApp({ log: false })

const BIN = path.join(TEST_ROOT, 'tex-bin')

/**
 * A stand-in for pdflatex: writes main.log / main.pdf the way TeX would, and records the
 * hardening environment it was started with in the "PDF" so the test can check it.
 */
const FAKE_TEX = `#!/usr/bin/env node
const fs = require('fs')
const src = fs.readFileSync('main.tex', 'utf8')
const args = process.argv.slice(2).join(' ')
if (src.includes('\\\\sleepforever')) setTimeout(() => {}, 60000)
else if (src.includes('\\\\undefinedthing')) {
  fs.writeFileSync('main.log', 'This is a fake TeX\\n./main.tex:3: Undefined control sequence.\\nl.3 \\\\undefinedthing\\n')
  process.exit(1)
} else {
  const passes = fs.existsSync('main.aux') ? Number(fs.readFileSync('main.aux', 'utf8')) + 1 : 1
  fs.writeFileSync('main.aux', String(passes))
  const rerun = src.includes('\\\\ref') && passes < 2
  fs.writeFileSync('main.log', rerun
    ? 'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.\\n'
    : 'LaTeX Warning: Reference \\x60x\\x27 on page 1 undefined on input line 7.\\nOutput written on main.pdf (1 page).\\n')
  fs.writeFileSync('main.pdf', '%PDF-1.5 fake passes=' + passes + ' openin=' + process.env.openin_any + ' shell=' + process.env.shell_escape + ' args=' + args)
}
`

before(() => {
  mkdirSync(BIN, { recursive: true })
  const file = path.join(BIN, 'pdflatex')
  writeFileSync(file, FAKE_TEX)
  chmodSync(file, 0o755)
  process.env.LATEX_BIN_DIR = BIN
  process.env.LATEX_ENGINE = 'pdflatex'
})

after(() => {
  delete process.env.LATEX_BIN_DIR
  delete process.env.LATEX_ENGINE
  delete process.env.LATEX_COMPILE
  delete process.env.LATEX_TIMEOUT_MS
})

beforeEach(() => resetEngineCache())

type Json = { success: boolean; data?: any; error?: string }
const compile = async (body: unknown) => {
  const res = await app.request('/api/plugins/latex/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Json }
}

const DOC = '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n'

test('status lists the engines found', async () => {
  const res = await app.request('/api/plugins/latex/status')
  const json = (await res.json()) as Json
  assert.equal(res.status, 200)
  assert.equal(json.data.enabled, true)
  assert.ok(json.data.engines.includes('pdflatex'))
  assert.equal(json.data.defaultEngine, 'pdflatex')
})

test('compiles to a PDF with shell escape off and paranoid file access', async () => {
  const r = await compile({ source: DOC })
  assert.equal(r.status, 200)
  assert.equal(r.json.data.ok, true)
  assert.equal(r.json.data.engine, 'pdflatex')
  const pdf = Buffer.from(r.json.data.pdf, 'base64').toString('utf8')
  assert.match(pdf, /^%PDF-/)
  assert.match(pdf, /openin=p/)
  assert.match(pdf, /shell=f/)
  assert.match(pdf, /-no-shell-escape/)
  assert.match(pdf, /-interaction=nonstopmode/)
  assert.deepEqual(r.json.data.issues, [{ severity: 'warning', message: "Reference `x' on page 1 undefined", line: 7 }])
})

test('reruns when TeX asks for it', async () => {
  const r = await compile({ source: DOC.replace('Hello', 'See \\ref{x}') })
  assert.equal(r.json.data.ok, true)
  assert.match(Buffer.from(r.json.data.pdf, 'base64').toString('utf8'), /passes=2/)
})

test('a TeX error comes back as issues with the line, not as an HTTP error', async () => {
  const r = await compile({ source: '\\documentclass{article}\n\\begin{document}\n\\undefinedthing\n\\end{document}\n' })
  assert.equal(r.status, 200)
  assert.equal(r.json.data.ok, false)
  assert.equal(r.json.data.pdf, null)
  assert.deepEqual(r.json.data.issues[0], { severity: 'error', message: 'Undefined control sequence.', line: 3 })
  assert.match(r.json.data.log, /Undefined control sequence/)
})

test('runs are stopped at the time limit and leave nothing behind', async () => {
  process.env.LATEX_TIMEOUT_MS = '300'
  try {
    const r = await compile({ source: '\\sleepforever' })
    assert.equal(r.json.data.ok, false)
    assert.equal(r.json.data.timedOut, true)
    assert.match(r.json.data.issues[0].message, /timed out/i)
  } finally {
    delete process.env.LATEX_TIMEOUT_MS
  }
  assert.equal(readdirSync(os.tmpdir()).filter((f) => f.startsWith('velocity-latex-')).length, 0)
})

test('validates the body and the engine', async () => {
  assert.equal((await compile({})).status, 400)
  assert.equal((await compile({ source: DOC, engine: 'bash' })).status, 400)
  const missing = await compile({ source: DOC, engine: 'tectonic' })
  // tectonic is only "installed" if the machine running the tests has it.
  if (missing.status === 400) assert.match(missing.json.error!, /not installed/)
})

test('LATEX_COMPILE=off answers 503', async () => {
  process.env.LATEX_COMPILE = 'off'
  try {
    const r = await compile({ source: DOC })
    assert.equal(r.status, 503)
    assert.match(r.json.error!, /off/)
  } finally {
    delete process.env.LATEX_COMPILE
  }
})

test('parseLatexLog reads classic errors and wrapped package warnings', () => {
  const log = [
    '! Missing $ inserted.',
    '<inserted text>',
    '                $',
    'l.14 a_b',
    '',
    'Package hyperref Warning: Token not allowed in a PDF string (Unicode):',
    '(hyperref)                removing `math shift\' on input line 21.',
    '',
  ].join('\n')
  assert.deepEqual(parseLatexLog(log), [
    { severity: 'error', message: 'Missing $ inserted.', line: 14 },
    { severity: 'warning', message: "Token not allowed in a PDF string (Unicode): removing `math shift'", line: 21 },
  ])
  assert.deepEqual(parseLatexLog('./main.tex:4: Undefined control sequence.\n./main.tex:4:  ==> Fatal error occurred, no output PDF file produced!\n'), [
    { severity: 'error', message: 'Undefined control sequence.', line: 4 },
  ])
  assert.deepEqual(parseLatexLog('! Emergency stop.\n'), [{ severity: 'error', message: 'Emergency stop.', line: undefined }])
  assert.equal(needsRerun('LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.'), true)
  assert.equal(needsRerun('Output written on main.pdf'), false)
})
