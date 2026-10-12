/**
 * HTML → Markdown converter tuned for blog posts (Medium, Substack, WordPress,
 * Ghost and friends).
 *
 * Pure DOM-in / string-out, so it runs unchanged in the browser and under
 * vitest's jsdom. The walker is block-oriented: `renderBlocks` turns a list of
 * sibling nodes into Markdown blocks (paragraphs, headings, lists, ...), while
 * `inline` renders phrasing content into a single string. Blocks are joined by
 * exactly one blank line, so the output never contains runs of blank lines
 * (except inside fenced code, which is copied verbatim).
 */

export interface MarkdownOptions {
  /** Keep `<img>` elements (default true). */
  images?: boolean
}

interface Ctx {
  base: string
  images: boolean
  /** Inside a heading: bold/italic markers add noise, so drop them. */
  plain: boolean
}

/** Elements whose content never belongs in a reading note. */
const SKIP = new Set([
  'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'button', 'form', 'input', 'nav',
  'aside', 'footer', 'template', 'select', 'textarea', 'head', 'link', 'meta', 'object', 'embed',
  'audio', 'video', 'dialog', 'math',
])

/** Elements that start a new block. Everything else is treated as phrasing content. */
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'main', 'header', 'address', 'center', 'details', 'summary',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'blockquote', 'table', 'hr',
  'figure', 'figcaption', 'dl', 'dt', 'dd', 'picture', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
])
const BLOCK_SELECTOR = [...BLOCK].filter((t) => t !== 'picture').join(',')

const ZERO_WIDTH = /\u200b|\u200c|\u200d|\u2060|\ufeff/g

/** Convert a DOM subtree to Markdown. `baseUrl` resolves relative links and images. */
export function htmlToMarkdown(
  root: Element | DocumentFragment,
  baseUrl: string,
  opts: MarkdownOptions = {},
): string {
  const ctx: Ctx = { base: baseUrl, images: opts.images !== false, plain: false }
  return renderBlocks(Array.from(root.childNodes), ctx).join('\n\n').trim()
}

// ───────────────────────── helpers ─────────────────────────

const tagOf = (n: Node): string => (n.nodeType === 1 ? (n as Element).tagName.toLowerCase() : '')

function isHidden(el: Element): boolean {
  if (el.hasAttribute('hidden')) return true
  const style = (el.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase()
  return style.includes('display:none') || style.includes('visibility:hidden')
}

/** Resolve a (possibly relative) URL; returns null for unusable / unsafe values. */
function resolveUrl(raw: string | null, base: string, allowed: string[]): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  try {
    const u = new URL(v, base)
    return allowed.includes(u.protocol) ? u.href : null
  } catch {
    return null
  }
}

/** Parentheses and whitespace would terminate a Markdown destination early. */
function destination(url: string): string {
  return url.replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/** Best image URL for an `<img>`, tolerating lazy-loading attributes. */
export function imageSource(img: Element, base: string): string | null {
  const candidates = [
    img.getAttribute('src'),
    img.getAttribute('data-src'),
    img.getAttribute('data-lazy-src'),
    img.getAttribute('data-original'),
    (img.getAttribute('srcset') ?? img.getAttribute('data-srcset') ?? '').split(',')[0]?.trim().split(/\s+/)[0],
  ]
  for (const c of candidates) {
    if (!c || c.trim().startsWith('data:')) continue
    const abs = resolveUrl(c, base, ['http:', 'https:'])
    if (abs) return abs
  }
  return null
}

/** 1×1 tracking pixels and friends. */
function isTinyImage(img: Element): boolean {
  const w = parseInt(img.getAttribute('width') ?? '', 10)
  const h = parseInt(img.getAttribute('height') ?? '', 10)
  return (Number.isFinite(w) && w <= 1) || (Number.isFinite(h) && h <= 1)
}

function collapse(text: string): string {
  return text.replace(ZERO_WIDTH, '').replace(/[\s\u00a0]+/g, ' ')
}

/** Escape characters that would be read as Markdown syntax in running text. */
function escapeText(s: string): string {
  let out = s
    .replace(/\*/g, '\\*')
    .replace(/`/g, '\\`')
    .replace(/~~/g, '\\~\\~')
    .replace(/<(?=[A-Za-z/!])/g, '\\<')
  // Underscores inside a word (snake_case) are inert; others could open emphasis.
  out = out.replace(/_/g, (m, off: number, str: string) =>
    /[\p{L}\p{N}]/u.test(str[off - 1] ?? '') && /[\p{L}\p{N}]/u.test(str[off + 1] ?? '') ? m : '\\_',
  )
  // Brackets only matter when they could form a link or reference: "](", "][".
  if (/\][([]/.test(out)) out = out.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
  return out
}

/** Escape alt text / link labels where brackets always matter. */
function escapeLabel(s: string): string {
  return s.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

/** Neutralise line-leading syntax (`#`, `>`, `-`, `1.` ...) that would change a paragraph's meaning. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
    .replace(/^>/, '\\>')
    .replace(/^([-+])(?=\s|$)/, '\\$1')
    .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2')
    .replace(/^([-=_])(?=\1{2,}\s*$)/, '\\$1')
}

/**
 * Turn an inline run into a paragraph: `\n` marks a `<br>` (kept as a two-space
 * hard break), every other whitespace run was already collapsed to one space.
 */
function finishInline(run: string): string {
  return run
    .split('\n')
    .map((l) => l.replace(/ {2,}/g, ' ').trim())
    .filter(Boolean)
    .map(escapeLineStart)
    .join('  \n')
}

/** Single-line variant (headings, table cells, captions): hard breaks become spaces. */
function flatten(run: string): string {
  return run.replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim()
}

/** Wrap `core` in a delimiter, keeping edge whitespace outside so `** x **` never happens. */
function wrap(inner: string, mark: string): string {
  const core = inner.trim()
  if (!core) return inner
  const lead = inner.startsWith(' ') ? ' ' : ''
  const trail = inner.endsWith(' ') ? ' ' : ''
  return `${lead}${mark}${core}${mark}${trail}`
}

function codeSpan(text: string): string {
  const t = text.replace(/\s+/g, ' ')
  if (!t.trim()) return ''
  const longest = Math.max(0, ...(t.match(/`+/g) ?? []).map((m) => m.length))
  const fence = '`'.repeat(longest + 1)
  const core = t.trim()
  const pad = core.startsWith('`') || core.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${core}${pad}${fence}`
}

// ───────────────────────── inline ─────────────────────────

/** Render phrasing content. Block descendants are flattened to space-separated text. */
function inline(nodes: Node[], ctx: Ctx): string {
  let out = ''
  for (const n of nodes) out += inlineNode(n, ctx)
  return out
}

function inlineNode(n: Node, ctx: Ctx): string {
  if (n.nodeType === 3) return escapeText(collapse(n.nodeValue ?? ''))
  if (n.nodeType !== 1) return ''
  const el = n as Element
  const tag = tagOf(el)
  if (SKIP.has(tag) || isHidden(el)) return ''
  const kids = () => inline(Array.from(el.childNodes), ctx)

  switch (tag) {
    case 'br':
      return '\n'
    case 'strong':
    case 'b':
      return ctx.plain ? kids() : wrap(kids(), '**')
    case 'em':
    case 'i':
    case 'cite':
      return ctx.plain ? kids() : wrap(kids(), '*')
    case 'del':
    case 's':
    case 'strike':
      return wrap(kids(), '~~')
    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt':
      return codeSpan(el.textContent ?? '')
    case 'sup':
    case 'sub': {
      const t = flatten(kids())
      return t ? `<${tag}>${t}</${tag}>` : ''
    }
    case 'img': {
      if (!ctx.images || isTinyImage(el)) return ''
      const src = imageSource(el, ctx.base)
      if (!src) return ''
      return `![${escapeLabel(collapse(el.getAttribute('alt') ?? '').trim())}](${destination(src)})`
    }
    case 'a': {
      const label = kids().replace(/\n/g, ' ')
      const raw = (el.getAttribute('href') ?? '').trim()
      if (!label.trim()) return ''
      if (!raw || raw.startsWith('#')) return label
      const href = resolveUrl(raw, ctx.base, ['http:', 'https:', 'mailto:', 'tel:'])
      if (!href) return label
      const core = label.trim()
      const lead = label.startsWith(' ') ? ' ' : ''
      const trail = label.endsWith(' ') ? ' ' : ''
      return `${lead}[${core}](${destination(href)})${trail}`
    }
    default: {
      const inner = kids()
      // Block elements met in an inline context (table cells, link wrappers) act as word breaks.
      return BLOCK.has(tag) ? ` ${inner} ` : inner
    }
  }
}

// ───────────────────────── blocks ─────────────────────────

/** Does this phrasing element need to be treated as a container (it holds blocks or images)? */
function needsContainer(el: Element, ctx: Ctx): boolean {
  if (el.querySelector(BLOCK_SELECTOR)) return true
  return ctx.images && !!el.querySelector('img') && tagOf(el) !== 'a'
}

/** A link that wraps nothing but an image: `[![alt](src)](href)`. */
function linkedImage(a: Element, ctx: Ctx): string | null {
  if (!ctx.images) return null
  const img = a.querySelector('img')
  if (!img || collapse(a.textContent ?? '').trim()) return null
  const md = inlineNode(img, ctx)
  if (!md) return null
  const href = resolveUrl(a.getAttribute('href'), ctx.base, ['http:', 'https:'])
  return href && !(a.getAttribute('href') ?? '').trim().startsWith('#') ? `[${md}](${destination(href)})` : md
}

function renderBlocks(nodes: Node[], ctx: Ctx): string[] {
  const blocks: string[] = []
  let run = ''

  const flush = () => {
    const p = finishInline(run)
    if (p) blocks.push(p)
    run = ''
  }

  for (const n of nodes) {
    if (n.nodeType === 3) {
      run += escapeText(collapse(n.nodeValue ?? ''))
      continue
    }
    if (n.nodeType !== 1) continue
    const el = n as Element
    const tag = tagOf(el)
    if (SKIP.has(tag) || isHidden(el)) continue

    if (tag === 'br') {
      run += '\n'
    } else if (tag === 'img') {
      flush()
      const md = inlineNode(el, ctx)
      if (md) blocks.push(md)
    } else if (BLOCK.has(tag)) {
      flush()
      blocks.push(...renderBlock(el, tag, ctx))
    } else if (needsContainer(el, ctx)) {
      flush()
      blocks.push(...renderBlocks(Array.from(el.childNodes), ctx))
    } else if (tag === 'a' && ctx.images && el.querySelector('img')) {
      const linked = linkedImage(el, ctx)
      if (linked) {
        flush()
        blocks.push(linked)
      } else {
        run += inlineNode(el, ctx)
      }
    } else {
      run += inlineNode(el, ctx)
    }
  }
  flush()
  return blocks
}

function renderBlock(el: Element, tag: string, ctx: Ctx): string[] {
  const kids = Array.from(el.childNodes)
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = flatten(inline(kids, { ...ctx, plain: true }))
      return text ? [`${'#'.repeat(Number(tag[1]))} ${text}`] : []
    }
    case 'p':
      return renderBlocks(kids, ctx)
    case 'hr':
      return ['---']
    case 'pre':
      return renderPre(el)
    case 'blockquote': {
      const inner = renderBlocks(kids, ctx).join('\n\n')
      if (!inner) return []
      return [inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')]
    }
    case 'ul':
    case 'ol':
      return renderList(el, tag === 'ol', ctx)
    case 'table':
      return renderTable(el, ctx)
    case 'figcaption': {
      const text = flatten(inline(kids, ctx))
      if (!text) return []
      return [text.includes('*') ? text : `*${text}*`]
    }
    case 'dt': {
      const text = flatten(inline(kids, { ...ctx, plain: true }))
      return text ? [`**${text}**`] : []
    }
    case 'summary': {
      const text = flatten(inline(kids, { ...ctx, plain: true }))
      return text ? [`**${text}**`] : []
    }
    default:
      // div, section, article, figure, dl, dd, details, picture, table parts, ...: plain containers.
      return renderBlocks(kids, ctx)
  }
}

/** Code block. Handles highlighter markup (spans, per-line divs, `<br>`) by reading text structurally. */
function renderPre(pre: Element): string[] {
  const code = pre.querySelector('code')
  const text = preText(pre).replace(/\n+$/, '').replace(/^\n+/, '')
  if (!text.trim()) return []

  // Languages show up as language-x / lang-x / highlight-source-x / data-lang on the code, pre or wrapper.
  let lang = ''
  for (const h of [code, pre, pre.parentElement]) {
    if (!h) continue
    const cls = `${h.getAttribute('class') ?? ''} ${h.getAttribute('data-language') ?? ''}`
    const m = /(?:language|lang|highlight-source|brush:)[-\s]+([\w+#.-]+)/i.exec(cls)
    const found = m?.[1] ?? h.getAttribute('data-lang') ?? h.getAttribute('data-language')
    if (found) {
      lang = found.toLowerCase()
      break
    }
  }
  if (lang === 'none' || lang === 'plain' || lang === 'plaintext' || lang === 'text') lang = ''

  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return [`${fence}${lang}\n${text}\n${fence}`]
}

function preText(node: Node): string {
  let out = ''
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) {
      out += c.nodeValue ?? ''
    } else if (c.nodeType === 1) {
      const el = c as Element
      const t = tagOf(el)
      if (t === 'br') {
        out += '\n'
        return
      }
      // Line-number gutters would pollute the copied code.
      if (/\b(line-numbers?|linenos?|gutter|lineno)\b/.test(el.getAttribute('class') ?? '')) return
      if (SKIP.has(t)) return // copy buttons, toolbars
      out += preText(el)
      // Highlighters that wrap each line in a block element rely on the element boundary for the newline.
      if ((t === 'div' || t === 'li' || t === 'tr') && !out.endsWith('\n')) out += '\n'
    }
  })
  return out
}

function renderList(list: Element, ordered: boolean, ctx: Ctx): string[] {
  const items: string[][] = [] // blocks per item
  const kidsOf = (li: Element): string[] => {
    // Task-list checkbox: first <input type=checkbox> that belongs to this item (not a nested list's).
    const box = Array.from(li.querySelectorAll('input[type="checkbox"]')).find((i) => i.closest('li') === li)
    const blocks = renderBlocks(Array.from(li.childNodes), ctx)
    if (box) {
      const mark = box.hasAttribute('checked') || (box as HTMLInputElement).checked ? '[x] ' : '[ ] '
      if (blocks.length) blocks[0] = mark + blocks[0]
      else blocks.push(mark.trim())
    }
    return blocks
  }

  Array.from(list.children).forEach((child) => {
    const t = tagOf(child)
    if (t === 'li') {
      items.push(kidsOf(child))
    } else if (t === 'ul' || t === 'ol') {
      // Invalid-but-common: a list directly inside a list belongs to the previous item.
      const nested = renderList(child, t === 'ol', ctx)
      if (items.length) items[items.length - 1].push(...nested)
      else items.push(nested)
    }
  })

  const start = ordered ? parseInt(list.getAttribute('start') ?? '1', 10) || 1 : 1
  const rendered = items
    .map((blocks, i) => ({ blocks, marker: ordered ? `${start + i}. ` : '- ' }))
    .filter(({ blocks }) => blocks.length)
    .map(({ blocks, marker }) => {
      const pad = ' '.repeat(ordered ? marker.length : 2)
      // Nested lists stay tight against their parent line; separate paragraphs get a blank line.
      let body = ''
      blocks.forEach((b, idx) => {
        if (idx === 0) body = b
        else body += (/^(?:[-*+]|\d+\.) /.test(b) ? '\n' : '\n\n') + b
      })
      return body
        .split('\n')
        .map((l, idx) => (idx === 0 ? marker + l : l ? pad + l : ''))
        .join('\n')
    })

  const loose = items.some((b) => b.filter((x) => !/^(?:[-*+]|\d+\.) /.test(x)).length > 1)
  return rendered.length ? [rendered.join(loose ? '\n\n' : '\n')] : []
}

function renderTable(table: Element, ctx: Ctx): string[] {
  const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table)
  const cellsOf = (tr: Element) => Array.from(tr.children).filter((c) => /^t[dh]$/.test(tagOf(c)))
  const grid = rows.map(cellsOf).filter((r) => r.length)
  if (!grid.length) return []

  // Layout tables and tables holding code/lists can't be expressed in GFM: emit cell contents as blocks.
  const complex = grid.some((r) => r.some((c) => c.querySelector('pre,ul,ol,table,blockquote,h1,h2,h3,h4,h5,h6')))
  if (complex) return grid.flatMap((r) => r.flatMap((c) => renderBlocks(Array.from(c.childNodes), ctx)))

  const text = grid.map((r) =>
    r.map((c) => flatten(inline(Array.from(c.childNodes), ctx)).replace(/\|/g, '\\|')),
  )
  if (text.every((r) => r.every((c) => !c))) return []

  const width = Math.max(...text.map((r) => r.length))
  const row = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`
  const [head, ...body] = text
  return [[row(head), row(Array(width).fill('---')), ...body.map(row)].join('\n')]
}
