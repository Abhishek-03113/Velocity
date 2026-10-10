import { defineConfig, devices } from '@playwright/test'

const API_PORT = Number(process.env.E2E_API_PORT ?? 3199)
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5199)

/**
 * End-to-end suite: real Hono server on a throwaway SQLite DB + Vite dev
 * server, driven by headless Chromium. Screenshots for design review are
 * written to docs/screenshots/after/.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'node e2e/start-server.mjs',
      port: API_PORT,
      reuseExistingServer: false,
      env: { PORT: String(API_PORT), CLIENT_URL: `http://localhost:${WEB_PORT}` },
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: false,
      env: { VITE_API_URL: `http://localhost:${API_PORT}`, PORT: String(API_PORT) },
      timeout: 60_000,
    },
  ],
})
