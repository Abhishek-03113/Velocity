import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.LANDING_PORT ?? 4174)

/**
 * Checks for the static marketing page in ../landing (no API, no database).
 * Run with `npm run test:landing` from the repo root. Review screenshots are written to
 * docs/screenshots/landing/.
 */
export default defineConfig({
  testDir: './e2e-landing',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite ../landing --port ${PORT} --strictPort --host 127.0.0.1`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
