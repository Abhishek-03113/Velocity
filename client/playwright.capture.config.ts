import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config'

/**
 * On-demand config for the landing-page media capture (e2e/capture/). The normal
 * suite ignores that directory. Run: `cd client && npm run capture:landing`.
 */
export default defineConfig({
  ...base,
  testDir: './e2e/capture',
  testIgnore: [],
  timeout: 240_000,
  projects: [{ name: 'capture', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
