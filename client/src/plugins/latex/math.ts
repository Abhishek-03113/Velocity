import katex from 'katex'

const cache = new Map<string, string>()
const MAX = 3000

/**
 * KaTeX with a small LRU cache: while typing, almost every formula is unchanged, so the
 * preview only pays for the one being edited.
 */
export function renderMath(tex: string, display: boolean, macros: Record<string, string>): string {
  const key = `${display ? 'D' : 'I'}\u0000${tex}\u0000${JSON.stringify(macros)}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  let html: string
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      macros: { ...macros },
      maxExpand: 1000,
    })
  } catch (err) {
    html = `<span class="ltx-math-error" title="${String(err).replace(/"/g, '&quot;')}">${tex.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`
  }
  cache.set(key, html)
  if (cache.size > MAX) cache.delete(cache.keys().next().value!)
  return html
}
