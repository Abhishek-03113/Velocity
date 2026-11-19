#!/usr/bin/env node
// Node.js vs Bun runtime benchmark for Velocity.
//
// Compares a pre-migration checkout (BASELINE_DIR, deps installed with `npm ci`, run on
// Node + tsx) with this checkout (deps installed with `bun install`, run on Bun). Both are
// measured on the same machine, alternating between them, so the results are directly
// comparable. The load generator (autocannon) runs on Node for both, so it is not part of
// the comparison.
//
//   BASELINE_DIR=/path/to/main-checkout AUTOCANNON=/path/to/autocannon \
//     node scripts/bench-runtime.mjs > results.json
//
// Sections can be skipped with SKIP=install,client,…  (install|startup|http|servertests|client)
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.BASELINE_DIR
const AUTOCANNON = process.env.AUTOCANNON ?? 'autocannon'
if (!BASE) throw new Error('Set BASELINE_DIR to a pre-migration checkout with npm-installed deps')
const SKIP = new Set((process.env.SKIP ?? '').split(',').filter(Boolean))
const log = (...a) => console.error('[bench]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const stats = (xs) => ({ runs: xs.map((x) => Math.round(x * 10) / 10), median: Math.round(median(xs) * 10) / 10, min: Math.round(Math.min(...xs) * 10) / 10 })
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `vbench-${p}-`))

/** Wall-clock ms of a shell command; throws on a non-zero exit unless allowFail. */
function timeCmd(cmd, cwd, env = {}, allowFail = false) {
  const t0 = performance.now()
  const r = spawnSync('bash', ['-c', cmd], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 })
  const ms = performance.now() - t0
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} failed in ${cwd}:\n${r.stdout}\n${r.stderr}`)
  return ms
}
function repeat(n, fn) { const out = []; for (let i = 0; i < n; i++) out.push(fn(i)); return out }
const du = (p) => Number(spawnSync('du', ['-sk', p]).stdout.toString().split('\t')[0]) / 1024

const RT = {
  node: { label: 'Node.js ' + process.version + ' + tsx', dir: BASE, server: ['node', ['--import', 'tsx', 'index.ts']] },
  bun: { label: 'Bun ' + spawnSync('bun', ['-v']).stdout.toString().trim(), dir: HERE, server: ['bun', ['index.ts']] },
}
const results = { machine: { cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memGB: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}` }, runtimes: { node: RT.node.label, bun: RT.bun.label }, at: new Date().toISOString() }

// ---------------------------------------------------------------- install
if (!SKIP.has('install')) {
  log('install')
  const inst = {}
  for (const pkg of ['server', 'client']) {
    const copy = (rt) => { const d = tmp(`${rt}-${pkg}`); for (const f of ['package.json', 'package-lock.json', 'bun.lock']) { const src = path.join(RT[rt].dir, pkg, f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(d, f)) } return d }
    const npmCold = [], bunCold = [], npmWarm = [], bunWarm = []
    const npmCache = tmp('npmcache'), bunCache = tmp('buncache')
    for (let i = 0; i < 2; i++) {
      const n = copy('node'); fs.rmSync(npmCache, { recursive: true, force: true })
      npmCold.push(timeCmd(`npm ci --no-audit --no-fund --cache ${npmCache}`, n))
      const b = copy('bun'); fs.rmSync(bunCache, { recursive: true, force: true })
      bunCold.push(timeCmd('bun install --frozen-lockfile', b, { BUN_INSTALL_CACHE_DIR: bunCache }))
    }
    for (let i = 0; i < 3; i++) {
      const n = copy('node'); npmWarm.push(timeCmd(`npm ci --no-audit --no-fund --cache ${npmCache}`, n))
      const b = copy('bun'); bunWarm.push(timeCmd('bun install --frozen-lockfile', b, { BUN_INSTALL_CACHE_DIR: bunCache }))
    }
    inst[pkg] = { node: { cold: stats(npmCold), warm: stats(npmWarm) }, bun: { cold: stats(bunCold), warm: stats(bunWarm) },
      node_modules_mb: { node: Math.round(du(path.join(BASE, pkg, 'node_modules'))), bun: Math.round(du(path.join(HERE, pkg, 'node_modules'))) } }
    log(pkg, JSON.stringify(inst[pkg]))
  }
  results.install = inst
}

// ---------------------------------------------------------------- server helpers
function serverEnv(port) {
  const d = tmp('srv')
  return { PORT: String(port), DB_PATH: path.join(d, 'v.db'), ASSETS_DIR: path.join(d, 'assets'), DOCS_DIR: path.join(d, 'docs'), BOOKS_DIR: path.join(d, 'books'), DOCS_SYNC: 'off', EMPTY_NOTE_CLEANUP: 'off', CLIENT_URL: 'http://localhost:5173' }
}
async function startServer(rt, port, quiet = true) {
  const [cmd, args] = RT[rt].server
  const t0 = performance.now()
  const child = spawn(cmd, args, { cwd: path.join(RT[rt].dir, 'server'), env: { ...process.env, ...serverEnv(port) }, stdio: quiet ? 'ignore' : 'inherit' })
  for (;;) {
    try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break } catch {}
    if (performance.now() - t0 > 30_000) throw new Error(`${rt} server did not start`)
    await sleep(2)
  }
  return { child, readyMs: performance.now() - t0 }
}
const rssMb = (pid) => { try { const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/); return m ? Number(m[1]) / 1024 : null } catch { return null } }
const stop = async (child) => { child.kill('SIGTERM'); await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r))) }

// ---------------------------------------------------------------- startup
if (!SKIP.has('startup')) {
  log('startup')
  const s = { node: [], bun: [], rss: { node: [], bun: [] } }
  for (let i = 0; i < 12; i++) for (const rt of ['node', 'bun']) {
    const { child, readyMs } = await startServer(rt, 3400 + i)
    await sleep(300); s.rss[rt].push(rssMb(child.pid)); s[rt].push(readyMs); await stop(child)
  }
  results.startup = { node: stats(s.node.slice(2)), bun: stats(s.bun.slice(2)), idle_rss_mb: { node: stats(s.rss.node), bun: stats(s.rss.bun) } }
  log(JSON.stringify(results.startup))
}

// ---------------------------------------------------------------- http throughput
function cannon(url, { method = 'GET', body, seconds = 10, connections = 50 } = {}) {
  const args = ['-j', '-c', String(connections), '-d', String(seconds), '-m', method]
  if (body) args.push('-H', 'content-type=application/json', '-b', body)
  const r = spawnSync(AUTOCANNON, [...args, url], { maxBuffer: 64 << 20 })
  const j = JSON.parse(r.stdout.toString())
  return { rps: j.requests.average, p50: j.latency.p50, p99: j.latency.p99, errors: j.errors + j.non2xx, total: j.requests.total }
}
if (!SKIP.has('http')) {
  log('http')
  const content = '# Note\n\n' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(36) // ~2 KB
  const cases = [
    ['GET /', (b) => [`${b}/`]],
    ['GET /api/pastes (list, 200 notes)', (b) => [`${b}/api/pastes`]],
    ['GET /api/pastes/:id (2 KB note)', (b) => [`${b}/api/pastes/42`]],
    ['PUT /api/pastes/:id (SQLite write)', (b) => [`${b}/api/pastes/43`, { method: 'PUT', body: JSON.stringify({ content: content + ' edited' }) }]],
  ]
  const http = {}
  for (const [name] of cases) http[name] = { node: [], bun: [] }
  const peak = { node: [], bun: [] }
  for (let round = 0; round < 2; round++) for (const rt of ['node', 'bun']) {
    const port = 3500 + round * 2 + (rt === 'bun' ? 1 : 0)
    const { child } = await startServer(rt, port)
    const base = `http://127.0.0.1:${port}`
    for (let i = 0; i < 200; i++) await fetch(`${base}/api/pastes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `Note ${i}`, content }) })
    cannon(`${base}/api/pastes`, { seconds: 3 }) // JIT warm-up
    for (const [name, mk] of cases) {
      const [url, opt] = mk(base)
      let maxRss = 0
      const iv = setInterval(() => { maxRss = Math.max(maxRss, rssMb(child.pid) ?? 0) }, 200)
      const r = await new Promise((res) => setImmediate(() => res(cannon(url, opt))))
      clearInterval(iv)
      http[name][rt].push(r)
      log(rt, name, Math.round(r.rps), 'req/s', 'p99', r.p99)
    }
    peak[rt].push(rssMb(child.pid))
    await stop(child)
  }
  const best = (xs) => xs.reduce((a, b) => (b.rps > a.rps ? b : a))
  results.http = Object.fromEntries(Object.entries(http).map(([k, v]) => [k, { node: best(v.node), bun: best(v.bun), rounds: v }]))
  results.http_rss_after_load_mb = { node: stats(peak.node), bun: stats(peak.bun) }
}

// ---------------------------------------------------------------- server tests
if (!SKIP.has('servertests')) {
  log('server tests')
  const nodeT = repeat(3, () => timeCmd('node --import tsx --test --test-concurrency=1 tests/*.test.ts', path.join(BASE, 'server'), {}, true))
  const bunIso = repeat(3, () => timeCmd('bun test --isolate tests/', path.join(HERE, 'server')))
  const bunPar = repeat(3, () => timeCmd('bun test --parallel tests/', path.join(HERE, 'server')))
  results.server_tests = { node: stats(nodeT), bun_isolate: stats(bunIso), bun_parallel: stats(bunPar) }
  log(JSON.stringify(results.server_tests))
}

// ---------------------------------------------------------------- client tooling
if (!SKIP.has('client')) {
  log('client')
  const cn = path.join(BASE, 'client'), cb = path.join(HERE, 'client')
  const pair = (n, nodeCmd, bunCmd, allowFail = false) => {
    const a = [], b = []
    for (let i = 0; i < n; i++) { a.push(timeCmd(nodeCmd, cn, {}, allowFail)); b.push(timeCmd(bunCmd, cb, {}, allowFail)) }
    return { node: stats(a), bun: stats(b) }
  }
  const c = {}
  c.vite_build = pair(3, 'npx vite build --logLevel error', 'bun --bun vite build --logLevel error')
  log('build', JSON.stringify(c.vite_build))
  // Both trees carry the same two pre-existing failures, so a non-zero exit is expected.
  c.vitest = pair(3, 'npx vitest run --reporter=dot', 'bun --bun vitest run --reporter=dot', true)
  log('vitest', JSON.stringify(c.vitest))
  c.tsc = pair(3, 'npx tsc --noEmit', 'bun --bun tsc --noEmit')
  log('tsc', JSON.stringify(c.tsc))
  c.eslint = pair(2, 'npx eslint . --ext ts,tsx --max-warnings 0', 'bun --bun eslint . --ext ts,tsx --max-warnings 0')
  log('eslint', JSON.stringify(c.eslint))
  // Vite dev server: spawn → first HTML response.
  const dev = { node: [], bun: [] }
  for (let i = 0; i < 5; i++) for (const rt of ['node', 'bun']) {
    const port = 5600 + i * 2 + (rt === 'bun' ? 1 : 0)
    const [cmd, args] = rt === 'node' ? ['npx', ['vite', '--port', String(port), '--strictPort']] : ['bun', ['--bun', 'vite', '--port', String(port), '--strictPort']]
    const t0 = performance.now()
    const child = spawn(cmd, args, { cwd: rt === 'node' ? cn : cb, stdio: 'ignore', detached: true })
    for (;;) { try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break } catch {} await sleep(5) }
    dev[rt].push(performance.now() - t0)
    process.kill(-child.pid, 'SIGTERM'); await sleep(300)
  }
  c.vite_dev_ready = { node: stats(dev.node), bun: stats(dev.bun) }
  log('dev', JSON.stringify(c.vite_dev_ready))
  results.client = c
}

console.log(JSON.stringify(results, null, 2))
