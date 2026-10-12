/**
 * Build-time runtime switch.
 *
 * `VITE_APP_ENV=production` builds the static (Vercel) deploy: there is no server, so notes,
 * folders, whiteboards and images live in `localStorage` (see lib/local/). Anything else keeps
 * the client–server model. Deliberately NOT `import.meta.env.PROD`: self-hosted Docker builds
 * are production builds too, and they do have a server.
 */
export const BROWSER_ONLY: boolean = import.meta.env.VITE_APP_ENV === 'production'
