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
  },
})
const stop = () => child.kill('SIGTERM')
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
child.on('exit', (code) => process.exit(code ?? 0))
