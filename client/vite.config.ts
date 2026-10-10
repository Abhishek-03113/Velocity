import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig(({ mode }) => {
  // Monorepo root `.env` supplies VITE_API_URL / PORT — no hardcoded host/port.
  const env = loadEnv(mode, rootDir, '')
  const viteApi = (process.env.VITE_API_URL || env.VITE_API_URL || '').replace(/\/$/, '')
  const port = process.env.PORT || env.PORT
  const apiTarget = viteApi || (port ? `http://localhost:${port}` : '')

  return {
    envDir: rootDir,
    plugins: [react()],
    // Pre-bundle the lazy whiteboard at server start so its first open never triggers a mid-session dep re-optimise and reload.
    optimizeDeps: { include: ['@excalidraw/excalidraw'] },
    build: {
      rollupOptions: {
        output: {
          // Keep the editor and the (large, lazy) whiteboard in their own cacheable chunks.
          manualChunks: {
            codemirror: [
              '@codemirror/state',
              '@codemirror/view',
              '@codemirror/commands',
              '@codemirror/language',
              '@codemirror/search',
              '@codemirror/autocomplete',
              '@codemirror/lang-markdown',
            ],
          },
        },
      },
    },
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
