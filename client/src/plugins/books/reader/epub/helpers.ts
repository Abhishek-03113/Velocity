/**
 * Pure helpers for the EPUB engine: TOC flattening, appearance → CSS rules, chapter lookup.
 * No epub.js or DOM imports so they are trivially unit-testable.
 */
import type { ReaderAppearance, ReaderColors, TocItem } from '../types'

/** The part of epub.js's `NavItem` the engine reads. */
export interface NavLike {
  id?: string
  href: string
  label: string
  subitems?: NavLike[]
}

export const MIN_FONT_SCALE = 0.8
export const MAX_FONT_SCALE = 1.6

export function clampFontScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, scale))
}

/** Depth-first flatten of epub.js's nested navigation into reading-order `TocItem`s. */
export function flattenToc(items: readonly NavLike[] | undefined, level = 0, out: TocItem[] = []): TocItem[] {
  for (const item of items ?? []) {
    const label = (item.label ?? '').replace(/\s+/g, ' ').trim()
    if (item.href) {
      out.push({ id: item.id || `toc-${out.length}`, label: label || item.href, target: item.href, level })
    }
    if (item.subitems?.length) flattenToc(item.subitems, level + 1, out)
  }
  return out
}

const FONT_STACKS = {
  serif: `Georgia, 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Times New Roman', serif`,
  sans: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
} as const

export type ThemeRules = Record<string, Record<string, string>>

/** Appearance + resolved colours → epub.js style rules (selector → declarations). */
export function buildThemeRules(appearance: Pick<ReaderAppearance, 'fontScale' | 'fontFamily'>, colors: ReaderColors): ThemeRules {
  const body: Record<string, string> = {
    color: `${colors.text} !important`,
    background: `${colors.background} !important`,
    'font-size': `${Math.round(clampFontScale(appearance.fontScale) * 100)}%`,
  }
  const rules: ThemeRules = {
    html: { background: `${colors.background} !important` },
    body,
    'a, a:link, a:visited': { color: `${colors.link} !important` },
    '::selection': { background: colors.selection },
  }
  if (appearance.fontFamily !== 'publisher') {
    const stack = FONT_STACKS[appearance.fontFamily]
    body['font-family'] = `${stack} !important`
    body['line-height'] = '1.6'
    rules['p, li, div, span, blockquote'] = { 'font-family': 'inherit !important' }
    rules['p, li'] = { 'line-height': '1.6' }
  }
  return rules
}

/** Serialise rules to a CSS string (used for a single replaceable `<style>` per chapter). */
export function rulesToCss(rules: ThemeRules): string {
  return Object.entries(rules)
    .map(([selector, decls]) => `${selector}{${Object.entries(decls).map(([k, v]) => `${k}:${v};`).join('')}}`)
    .join('\n')
}

function stripFragment(href: string): string {
  const i = href.indexOf('#')
  return i === -1 ? href : href.slice(0, i)
}

function samePath(a: string, b: string): boolean {
  if (a === b) return true
  // TOC hrefs are relative to the nav document, spine hrefs to the package; tolerate a differing folder prefix.
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

/**
 * Label of the chapter containing `href`: the TOC entry for that file, else the nearest earlier spine item
 * that has one. `spineHrefs` is the reading order. Null when nothing matches.
 */
export function chapterLabelForHref(href: string | undefined, toc: readonly TocItem[], spineHrefs: readonly string[] = []): string | null {
  if (!href) return null
  const file = stripFragment(href)
  const find = (f: string): TocItem | undefined => toc.find((t) => samePath(stripFragment(t.target), f))
  const direct = find(file)
  if (direct) return direct.label
  let idx = spineHrefs.findIndex((h) => samePath(stripFragment(h), file))
  for (idx -= 1; idx >= 0; idx--) {
    const hit = find(stripFragment(spineHrefs[idx]))
    if (hit) return hit.label
  }
  return null
}
