// Boots the real API on a fresh, throwaway data directory for each E2E run.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = mkdtempSync(path.join(os.tmpdir(), 'velocity-e2e-'))
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server')
const child = spawn('npx', ['tsx', 'index.ts'], {
  cwd: serverDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DB_PATH: path.join(root, 'velocity.db'),
    ASSETS_DIR: path.join(root, 'assets'),
    DOCS_DIR: path.join(root, 'docs'),
    PLUGIN_FETCH_ALLOW_PRIVATE: 'on', // E2E serves fixtures on localhost
    // herdr connector: e2e/herdr.spec.ts serves a fake herdr socket at this path.
    HERDR_CONNECTOR_TOKEN: 'e2e-herdr-token',
    HERDR_SOCKET_PATH: path.join(os.tmpdir(), `velocity-e2e-herdr-${process.env.PORT ?? '3199'}.sock`),
    // LaTeX plugin: a stand-in pdflatex (CI has no TeX), found ahead of anything on PATH.
    LATEX_BIN_DIR: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/tex-bin'),
    LATEX_ENGINE: 'pdflatex',
  },
})
const stop = () => child.kill('SIGTERM')
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
child.on('exit', (code) => process.exit(code ?? 0))
