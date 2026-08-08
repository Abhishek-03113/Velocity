import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig(({ mode }) => {
  // Monorepo root `.env` supplies VITE_API_URL / PORT — no hardcoded host/port.
  const env = loadEnv(mode, rootDir, '')
  const viteApi = (process.env.VITE_API_URL || env.VITE_API_URL || '').replace(/\/$/, '')
  const port = process.env.PORT || env.PORT
  const apiTarget = viteApi || (port ? `http://localhost:${port}` : '')

  return {
    envDir: rootDir,
    plugins: [react(), tailwindcss()],
    server: apiTarget
      ? {
          proxy: {
            '/api': {
              target: apiTarget,
              changeOrigin: true,
            },
          },
        }
      : undefined,
  }
})
