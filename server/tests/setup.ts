import { mkdtempSync } from 'fs'
import os from 'os'
import path from 'path'

/** Isolated DB / assets / export dir per test process — import before anything touching the DB. */
const root = mkdtempSync(path.join(os.tmpdir(), 'velocity-test-'))
process.env.DB_PATH = path.join(root, 'test.db')
process.env.ASSETS_DIR = path.join(root, 'assets')
process.env.DOCS_DIR = path.join(root, 'docs')
process.env.DOCS_SYNC = 'off'

export const TEST_ROOT = root
