import { defineConfig, devices } from '@playwright/test'

const WEB_PORT = Number(process.env.E2E_LOCAL_PORT ?? 5299)

/**
 * Browser-only (Vercel) build: no server at all. Serves the production-mode static build with
 * `vite preview` and drives it with headless Chromium. CI only — see CLAUDE.md.
 */
export default defineConfig({
  testDir: './e2e-local',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `VITE_APP_ENV=production npx vite build && npx vite preview --port ${WEB_PORT} --strictPort`,
    port: WEB_PORT,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
