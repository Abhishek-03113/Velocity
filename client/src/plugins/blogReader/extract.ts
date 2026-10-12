/**
 * Article extraction: raw page HTML in, clean Markdown + metadata out.
 *
 * Pipeline: parse → make URLs resolvable → promote lazy-loaded images → read
 * metadata (Open Graph, JSON-LD, <time>) → isolate the article body with
 * Mozilla Readability (falling back to <article>/<main>/<body>) → convert to
 * Markdown. Everything is plain DOM, so it runs in the browser and in jsdom.
 */
import { Readability } from '@mozilla/readability'
import { htmlToMarkdown, imageSource } from './markdown'

export interface Article {
  title: string
  byline: string | null
  siteName: string | null
  /** ISO date (`YYYY-MM-DD`) or null. */
  published: string | null
  excerpt: string | null
  url: string
  markdown: string
  /** Absolute URLs of the images that made it into `markdown`. */
  images: string[]
  wordCount: number
}

export interface ExtractOptions {
  /** Keep images (default true). */
  images?: boolean
}

/** Extract the readable article from a page. Never throws on odd markup; always returns a title. */
export function extractArticle(html: string, pageUrl: string, opts: ExtractOptions = {}): Article {
  const withImages = opts.images !== false
  const doc = new DOMParser().parseFromString(html, 'text/html')
  ensureBase(doc, pageUrl)
  promoteLazyImages(doc, pageUrl)

  // Metadata first: Readability works on a clone, but we want the untouched <head> and JSON-LD.
  const jsonLd = readJsonLd(doc)
  const host = hostnameOf(pageUrl)
  const siteName = clean(meta(doc, 'og:site_name') ?? meta(doc, 'application-name')) || host || null

  const readable = runReadability(doc)
  const body = readable?.body ?? fallbackBody(doc)

  const title = pickTitle(doc, readable?.title, siteName, host, pageUrl)
  const byline = pickByline(doc, readable?.byline, jsonLd)
  const published = pickPublished(doc, jsonLd, readable?.published)
  const excerpt =
    clean(readable?.excerpt) || clean(meta(doc, 'og:description') ?? meta(doc, 'description')) || null

  removeLeadingTitle(body, title)
  const markdown = htmlToMarkdown(body, pageUrl, { images: withImages })

  return {
    title,
    byline,
    siteName,
    published,
    excerpt,
    url: pageUrl,
    markdown,
    images: withImages ? imagesIn(markdown) : [],
    wordCount: countWords(body.textContent ?? ''),
  }
}

// ───────────────────────── document prep ─────────────────────────

/** Relative URLs only resolve if the parsed document knows where it came from. */
function ensureBase(doc: Document, pageUrl: string): void {
  const existing = doc.querySelector('base[href]')
  const href = existing?.getAttribute('href')
  if (href) {
    try {
      // A relative <base href="/x/"> must itself be resolved against the page.
      existing!.setAttribute('href', new URL(href, pageUrl).href)
      return
    } catch {
      existing!.remove()
    }
  }
  const base = doc.createElement('base')
  base.setAttribute('href', pageUrl)
  ;(doc.head ?? doc.documentElement).prepend(base)
}

const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-orig-file', 'data-actual-src']
const PIXEL_URL = /(?:^|[/_.-])(?:1x1|pixel|spacer|blank|beacon|tracking)[^/]*\.(?:gif|png|jpe?g)(?:$|\?)/i

/**
 * Lazy-loading plugins leave a placeholder in `src` and the real image in a
 * data attribute or `srcset`. Put the best candidate into `src`, and drop
 * images that are only tracking pixels.
 */
function promoteLazyImages(doc: Document, pageUrl: string): void {
  doc.querySelectorAll('img').forEach((img) => {
    const lazy = LAZY_ATTRS.map((a) => img.getAttribute(a)).find((v) => v && v.trim() && !v.trim().startsWith('data:'))
    // <picture><source srcset> is the only source when the <img> itself is bare.
    const sourceSet = img.parentElement?.tagName === 'PICTURE'
      ? img.parentElement.querySelector('source[srcset]')?.getAttribute('srcset')
      : null
    const set = img.getAttribute('srcset') || img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset') || sourceSet
    const src = (img.getAttribute('src') ?? '').trim()
    const srcUsable = !!src && !src.startsWith('data:') && !PIXEL_URL.test(src)

    if (lazy) img.setAttribute('src', lazy.trim())
    else if (!srcUsable) {
      const best = set ? largestCandidate(set) : null
      if (best) img.setAttribute('src', best)
    }

    const w = parseInt(img.getAttribute('width') ?? '', 10)
    const h = parseInt(img.getAttribute('height') ?? '', 10)
    const tiny = (Number.isFinite(w) && w <= 1) || (Number.isFinite(h) && h <= 1)
    const final = imageSource(img, pageUrl)
    if (tiny || !final || PIXEL_URL.test(final)) img.remove()
  })
}

/** Highest-resolution entry of a `srcset` (by `w`, else `x` descriptor). */
export function largestCandidate(srcset: string): string | null {
  let best: { url: string; score: number } | null = null
  for (const part of srcset.split(/,\s+|,(?=\S+\s+\d+(?:\.\d+)?[wx])/)) {
    const [url, desc] = part.trim().split(/\s+/)
    if (!url) continue
    const n = parseFloat(desc ?? '')
    const score = Number.isFinite(n) ? (desc!.endsWith('x') ? n * 1000 : n) : 0
    if (!best || score > best.score) best = { url, score }
  }
  return best?.url ?? null
}

// ───────────────────────── body ─────────────────────────

interface Readable {
  body: Element
  title: string
  byline: string | null
  excerpt: string | null
  published: string | null
}

function runReadability(doc: Document): Readable | null {
  try {
    // keepClasses retains `language-xxx` on code blocks, which the Markdown converter reads.
    const article = new Readability(doc.cloneNode(true) as Document, { keepClasses: true }).parse()
    if (!article?.content) return null
    const holder = new DOMParser().parseFromString(`<body>${article.content}</body>`, 'text/html').body
    if (!(holder.textContent ?? '').trim()) return null
    return {
      body: holder,
      title: article.title ?? '',
      byline: article.byline ?? null,
      excerpt: article.excerpt ?? null,
      published: article.publishedTime ?? null,
    }
  } catch {
    return null
  }
}

/** When Readability gives up (very short or unusual pages), take the most article-like container. */
function fallbackBody(doc: Document): Element {
  const longest = (els: Element[]) =>
    els.sort((a, b) => (b.textContent ?? '').length - (a.textContent ?? '').length)[0]
  for (const sel of ['article', 'main', '[role="main"]']) {
    const hit = longest(Array.from(doc.querySelectorAll(sel)))
    if (hit && (hit.textContent ?? '').trim()) return hit.cloneNode(true) as Element
  }
  return (doc.body ?? doc.documentElement).cloneNode(true) as Element
}

/** We render our own header, so a body that opens with the post's <h1> would repeat the title. */
function removeLeadingTitle(body: Element, title: string): void {
  const h1 = body.querySelector('h1')
  if (!h1) return
  const a = norm(h1.textContent ?? '')
  const b = norm(title)
  if (!a || !b || !(a === b || a.includes(b) || b.includes(a))) return
  const before = (body.textContent ?? '').indexOf(h1.textContent ?? '')
  if (before > 200) return
  h1.remove()
}

// ───────────────────────── metadata ─────────────────────────

function meta(doc: Document, name: string): string | null {
  const el = doc.querySelector(`meta[property="${name}" i], meta[name="${name}" i], meta[itemprop="${name}" i]`)
  return el?.getAttribute('content')?.trim() || null
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/[\s\u00a0]+/g, ' ').trim()
const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** "Post title | My Blog" → "Post title" when the suffix is the site name. */
function stripSiteSuffix(title: string, siteName: string | null, host: string): string {
  const names = [siteName, host, host.split('.').slice(-2, -1)[0]].filter(Boolean).map((n) => norm(n!))
  const parts = title.split(/\s+(?:[|·•–—-]|::)\s+/)
  if (parts.length < 2) return title
  const last = norm(parts[parts.length - 1])
  const first = norm(parts[0])
  if (names.includes(last)) return parts.slice(0, -1).join(' - ')
  if (names.includes(first)) return parts.slice(1).join(' - ')
  return title
}

function pickTitle(
  doc: Document,
  readabilityTitle: string | undefined,
  siteName: string | null,
  host: string,
  pageUrl: string,
): string {
  const candidates = [
    meta(doc, 'og:title'),
    meta(doc, 'twitter:title'),
    readabilityTitle,
    doc.querySelector('h1')?.textContent,
    doc.title,
  ]
  for (const c of candidates) {
    const t = stripSiteSuffix(clean(c), siteName, host)
    if (t) return t
  }
  return host || pageUrl
}

function pickByline(doc: Document, readabilityByline: string | null | undefined, ld: LdNode[]): string | null {
  const candidates = [
    readabilityByline,
    meta(doc, 'author'),
    meta(doc, 'article:author'),
    doc.querySelector('[rel="author"]')?.textContent,
    ...ld.map((n) => personName(n.author)),
  ]
  for (const c of candidates) {
    // "By Jane Doe" → "Jane Doe"; skip profile URLs and runaway text scraped as a byline.
    const t = clean(c).replace(/^by\s+/i, '')
    if (t && t.length <= 100 && !/^https?:\/\//i.test(t)) return t
  }
  return null
}

function pickPublished(doc: Document, ld: LdNode[], readabilityDate: string | null | undefined): string | null {
  const candidates = [
    meta(doc, 'article:published_time'),
    meta(doc, 'og:article:published_time'),
    meta(doc, 'datePublished'),
    meta(doc, 'date'),
    doc.querySelector('article time[datetime], time[datetime][pubdate], time[datetime]')?.getAttribute('datetime'),
    ...ld.map((n) => (typeof n.datePublished === 'string' ? n.datePublished : null)),
    readabilityDate,
  ]
  for (const c of candidates) {
    const d = toIsoDate(c)
    if (d) return d
  }
  return null
}

/** Normalise any date string to `YYYY-MM-DD`; keeps the author's calendar day when one is given. */
function toIsoDate(value: string | null | undefined): string | null {
  const v = clean(value)
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

// JSON-LD ------------------------------------------------------

type LdNode = Record<string, unknown> & { author?: unknown; datePublished?: unknown }

/** Flatten every JSON-LD block (including `@graph` arrays) into a list of nodes. */
function readJsonLd(doc: Document): LdNode[] {
  const out: LdNode[] = []
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v === 'object') {
      out.push(v as LdNode)
      visit((v as Record<string, unknown>)['@graph'])
    }
  }
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      visit(JSON.parse(s.textContent ?? ''))
    } catch {
      /* malformed JSON-LD is common; ignore it */
    }
  })
  return out
}

function personName(author: unknown): string | null {
  if (typeof author === 'string') return author
  if (Array.isArray(author)) return author.map(personName).filter(Boolean).join(', ') || null
  if (author && typeof author === 'object') {
    const name = (author as { name?: unknown }).name
    return typeof name === 'string' ? name : null
  }
  return null
}

// ───────────────────────── output ─────────────────────────

/** Absolute URLs of the images in the generated Markdown, in order, de-duplicated. */
function imagesIn(markdown: string): string[] {
  const urls = new Set<string>()
  for (const m of markdown.matchAll(/!\[(?:\\.|[^\]\\])*\]\(([^)\s]+)\)/g)) {
    urls.add(m[1].replace(/%28/g, '(').replace(/%29/g, ')'))
  }
  return [...urls]
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}
