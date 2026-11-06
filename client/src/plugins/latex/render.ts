/**
 * LaTeX → HTML for the live preview. It is not TeX: it covers what notes, papers and homework
 * usually use (sections, lists, maths, tables, figures, theorems, references, footnotes, a
 * title block) and stays forgiving while you type: unknown commands show muted, unbalanced
 * input never throws. The PDF from the server's TeX engine is the real output.
 *
 * Pure: maths goes through `opts.math` (KaTeX in the app), so this file has no imports and
 * is easy to test.
 */

export interface RenderOptions {
  /** Render TeX maths to HTML (display or inline). Must not throw. */
  math: (tex: string, display: boolean, macros: Record<string, string>) => string
  /** URL for an `\includegraphics` path, or null to show a placeholder box. */
  resolveImage?: (path: string) => string | null
  /** Shown by `\today` and an implicit `\date`. */
  today?: Date
}

export interface RenderResult {
  html: string
  /** Plain-text `\title`, when there is one. */
  title: string | null
  /** Commands and environments the preview skipped, for the status line. */
  unsupported: string[]
}

// Private-use markers that cannot appear in escaped output.
const BLOCK_START = ''
const BLOCK_END = ''
const PAR = ''
const HOLE = '' // kind:key → resolved at the end (refs, cites, toc)
const RAW = '' // n → protected verbatim text

const MATH_ENVS = new Set([
  'equation', 'align', 'gather', 'multline', 'flalign', 'alignat', 'eqnarray', 'displaymath', 'math',
])
const VERBATIM_ENVS = ['verbatim', 'Verbatim', 'lstlisting', 'minted', 'comment', 'verbatim*']
const THEOREMS: Record<string, string> = {
  theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition', corollary: 'Corollary', definition: 'Definition',
  remark: 'Remark', example: 'Example', conjecture: 'Conjecture', claim: 'Claim', exercise: 'Exercise',
  problem: 'Problem', solution: 'Solution', note: 'Note', observation: 'Observation',
}
const INLINE_TAGS: Record<string, [string, string]> = {
  textbf: ['<strong>', '</strong>'], textit: ['<em>', '</em>'], emph: ['<em>', '</em>'], textsl: ['<em>', '</em>'],
  texttt: ['<code class="ltx-tt">', '</code>'], underline: ['<u>', '</u>'], uline: ['<u>', '</u>'],
  textsc: ['<span class="ltx-sc">', '</span>'], textsf: ['<span class="ltx-sf">', '</span>'],
  textrm: ['<span class="ltx-rm">', '</span>'], textup: ['<span>', '</span>'], textmd: ['<span>', '</span>'],
  textnormal: ['<span class="ltx-rm">', '</span>'], mbox: ['<span class="ltx-nowrap">', '</span>'],
  hbox: ['<span class="ltx-nowrap">', '</span>'], makebox: ['<span>', '</span>'], text: ['<span>', '</span>'],
  fbox: ['<span class="ltx-fbox">', '</span>'], framebox: ['<span class="ltx-fbox">', '</span>'],
  textsuperscript: ['<sup>', '</sup>'], textsubscript: ['<sub>', '</sub>'], sout: ['<s>', '</s>'],
  st: ['<s>', '</s>'], hl: ['<mark>', '</mark>'],
}
/** Declarations that style the rest of the current group. */
const DECLARATIONS: Record<string, [string, string]> = {
  bfseries: ['<strong>', '</strong>'], bf: ['<strong>', '</strong>'], itshape: ['<em>', '</em>'], it: ['<em>', '</em>'],
  em: ['<em>', '</em>'], slshape: ['<em>', '</em>'], sl: ['<em>', '</em>'],
  ttfamily: ['<span class="ltx-tt">', '</span>'], tt: ['<span class="ltx-tt">', '</span>'],
  sffamily: ['<span class="ltx-sf">', '</span>'], sf: ['<span class="ltx-sf">', '</span>'],
  scshape: ['<span class="ltx-sc">', '</span>'], sc: ['<span class="ltx-sc">', '</span>'],
  rmfamily: ['<span class="ltx-rm">', '</span>'], normalfont: ['<span class="ltx-rm">', '</span>'],
  upshape: ['<span>', '</span>'], mdseries: ['<span>', '</span>'],
}
const SIZES = ['tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge']
const SYMBOLS: Record<string, string> = {
  ldots: '…', dots: '…', textellipsis: '…', textendash: '–', textemdash: '—', textbar: '|', textless: '&lt;',
  textgreater: '&gt;', textbackslash: '\\', textasciitilde: '~', textasciicircum: '^', textunderscore: '_',
  S: '§', P: '¶', copyright: '©', textcopyright: '©', dag: '†', ddag: '‡', textdagger: '†', textdaggerdbl: '‡',
  pounds: '£', textsterling: '£', euro: '€', texteuro: '€', textregistered: '®', texttrademark: '™',
  textdegree: '°', ss: 'ß', ae: 'æ', AE: 'Æ', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', oe: 'œ', OE: 'Œ', l: 'ł', L: 'Ł',
  i: 'ı', j: 'ȷ', textbullet: '•', textperiodcentered: '·', textquoteleft: '‘', textquoteright: '’',
  textquotedblleft: '“', textquotedblright: '”', guillemotleft: '«', guillemotright: '»', checkmark: '✓',
  quad: ' ', qquad: '  ', enspace: ' ', thinspace: ' ', hfill: ' ', hfil: ' ',
  dotfill: ' … ', break: '', nobreak: '', allowbreak: '', relax: '', protect: '', centering: '',
  noindent: '', indent: '', strut: '', null: '', leavevmode: '', unskip: '', ignorespaces: '', nocite: '',
}
const ACCENTS: Record<string, string> = {
  "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇',
  u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊', d: '̣', b: '̱',
}
/** Commands whose arguments are configuration: consumed silently (count = mandatory args). */
const SILENT: Record<string, number> = {
  documentclass: 1, usepackage: 1, RequirePackage: 1, pagestyle: 1, thispagestyle: 1, pagenumbering: 1,
  setlength: 2, addtolength: 2, setcounter: 2, addtocounter: 2, stepcounter: 1, refstepcounter: 1, geometry: 1,
  hypersetup: 1, bibliographystyle: 1, graphicspath: 1, numberwithin: 2, setcitestyle: 1, lstset: 1,
  definecolor: 3, color: 1, linespread: 1, selectlanguage: 1, captionsetup: 1, addbibresource: 1,
  setlist: 1, tikzset: 1, pgfplotsset: 1, renewenvironment: 3, newenvironment: 3, newcounter: 1,
  index: 1, glossary: 1, markboth: 2, markright: 1, title: 1, author: 1, date: 1, thanks: 1, vspace: 1,
  hspace: 1, newlength: 1, phantomsection: 0, frenchspacing: 0, sloppy: 0, raggedbottom: 0, flushbottom: 0,
  onecolumn: 0, twocolumn: 0, appendix: 0, makeatletter: 0, makeatother: 0, printbibliography: 0,
  listoffigures: 0, listoftables: 0, smallskip: 0, medskip: 0, bigskip: 0, vfill: 0, displaystyle: 0,
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const block = (html: string) => BLOCK_START + html + BLOCK_END
const isLetter = (c: string | undefined) => c != null && /[A-Za-z@]/.test(c)

function safeUrl(url: string): string | null {
  const u = url.trim()
  if (/^(https?:|mailto:)/i.test(u) || u.startsWith('#') || u.startsWith('/')) return u
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return `https://${u}`
  return null
}

/** Strip `%` comments (an unescaped `%` eats the rest of the line and its newline). */
export function stripComments(src: string): string {
  return src.replace(/(?<=(?:^|[^\\])(?:\\\\)*)%[^\n]*(\n[ \t]*)?/g, '')
}

/** Index of the `}` closing the group whose `{` is at `start`, or -1. */
function closeOf(s: string, start: number): number {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

function skipSpace(s: string, i: number, newlines = true): number {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || (newlines && s[i] === '\n' && s[i + 1] !== '\n'))) i++
  return i
}

/** One TeX argument at `i`: a braced group, a command, or a single character. */
function readArg(s: string, i: number): { value: string; end: number } | null {
  i = skipSpace(s, i)
  if (i >= s.length) return null
  if (s[i] === '{') {
    const end = closeOf(s, i)
    if (end < 0) return { value: s.slice(i + 1), end: s.length }
    return { value: s.slice(i + 1, end), end: end + 1 }
  }
  if (s[i] === '\\') {
    let j = i + 1
    if (isLetter(s[j])) while (isLetter(s[j])) j++
    else j++
    return { value: s.slice(i, j), end: j }
  }
  if (s[i] === '}') return null
  return { value: s[i]!, end: i + 1 }
}

function readOptional(s: string, i: number): { value: string; end: number } | null {
  const j = skipSpace(s, i)
  if (s[j] !== '[') return null
  let depth = 0
  for (let k = j + 1; k < s.length; k++) {
    const c = s[k]
    if (c === '\\') {
      k++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === ']' && depth === 0) return { value: s.slice(j + 1, k), end: k + 1 }
  }
  return null
}

/** Where the `\end{name}` matching a `\begin{name}` (whose body starts at `from`) begins. */
function findEnd(s: string, from: number, name: string): { bodyEnd: number; end: number } {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\\\(begin|end)\\s*\\{${esc}\\}`, 'g')
  re.lastIndex = from
  let depth = 1
  for (let m = re.exec(s); m; m = re.exec(s)) {
    depth += m[1] === 'begin' ? 1 : -1
    if (depth === 0) return { bodyEnd: m.index, end: m.index + m[0].length }
  }
  return { bodyEnd: s.length, end: s.length }
}

/**
 * Split `s` at top-level matches of `sep` (not inside braces or nested environments).
 * `sep` returns the length of a separator at `i`, or 0.
 */
function splitTop(s: string, sep: (s: string, i: number) => number): { parts: string[]; seps: string[] } {
  const parts: string[] = []
  const seps: string[] = []
  let depth = 0
  let env = 0
  let last = 0
  for (let i = 0; i < s.length; i++) {
    if (depth === 0 && env === 0) {
      const n = sep(s, i)
      if (n > 0) {
        parts.push(s.slice(last, i))
        seps.push(s.slice(i, i + n))
        last = i + n
        i += n - 1
        continue
      }
    }
    const c = s[i]
    if (c === '\\') {
      if (s.startsWith('\\begin', i)) env++
      else if (s.startsWith('\\end', i)) env--
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
  }
  parts.push(s.slice(last))
  return { parts, seps }
}

const rowSep = (s: string, i: number) => {
  if (!s.startsWith('\\\\', i)) return 0
  let n = 2
  if (s[i + 2] === '*') n++
  const opt = readOptional(s, i + n)
  return opt && s[i + n] === '[' ? opt.end - i : n
}
const cellSep = (s: string, i: number) => (s[i] === '&' && s[i - 1] !== '\\' ? 1 : 0)
const itemSep = (s: string, i: number) => (s.startsWith('\\item', i) && !isLetter(s[i + 5]) ? 5 : 0)
const bibSep = (s: string, i: number) => (s.startsWith('\\bibitem', i) && !isLetter(s[i + 8]) ? 8 : 0)

function plainText(tex: string): string {
  return tex
    .replace(/\\(?:thanks|footnote)\s*\{[^{}]*\}/g, '')
    .replace(/\\(?:and|\\)/g, ', ')
    .replace(/\\[A-Za-z]+\*?/g, ' ')
    .replace(/[{}$~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

interface TocEntry {
  level: number
  number: string
  title: string
  id: string
}

class Renderer {
  private macros: Record<string, string> = {}
  private textMacros = new Map<string, { args: number; optional?: string; body: string }>()
  private theorems = new Map<string, { title: string; counter: string }>()
  private counters: Record<string, number> = {}
  private sectionCounters = [0, 0, 0, 0, 0]
  private hasChapters = false
  private labels = new Map<string, string>()
  private currentLabel = ''
  private cites = new Map<string, number>()
  private footnotes: string[] = []
  private toc: TocEntry[] = []
  private raws: { env: string; lang: string; text: string }[] = []
  private unsupported = new Set<string>()
  private envStack: string[] = []
  private expansions = 0
  meta: { title?: string; author?: string; date?: string } = {}

  constructor(private opts: RenderOptions) {
    for (const [name, title] of Object.entries(THEOREMS)) this.theorems.set(name, { title, counter: name })
  }

  render(source: string): RenderResult {
    let src = this.protectVerbatim(source.replace(/\r\n?/g, '\n'))
    src = stripComments(src)
    const begin = /\\begin\s*\{document\}/.exec(src)
    let preamble = ''
    let body = src
    if (begin) {
      preamble = src.slice(0, begin.index)
      const rest = src.slice(begin.index + begin[0].length)
      const end = /\\end\s*\{document\}/.exec(rest)
      body = end ? rest.slice(0, end.index) : rest
    }
    this.hasChapters = /\\chapter\b/.test(body)
    this.scanDefinitions(preamble)
    this.scanDefinitions(body)
    // Bibliography numbers first, so citations before the list resolve.
    let n = 0
    for (const m of body.matchAll(/\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) this.cites.set(m[1]!.trim(), ++n)

    let html = this.renderBlock(body)
    html = this.resolveHoles(html)
    if (this.footnotes.length) {
      html += `<section class="ltx-footnotes"><ol>${this.footnotes
        .map((f, i) => `<li id="ltx-fn-${i + 1}">${this.resolveHoles(f)} <a href="#ltx-fnref-${i + 1}" class="ltx-backref">↩</a></li>`)
        .join('')}</ol></section>`
    }
    html = html.replace(new RegExp(`${RAW}(\\d+)${RAW}`, 'g'), (_, i: string) => escapeHtml(this.raws[Number(i)]?.text ?? ''))
    return {
      html,
      title: this.meta.title != null ? plainText(this.meta.title) || null : null,
      unsupported: [...this.unsupported].sort(),
    }
  }

  // ---- set-up passes -------------------------------------------------------

  private protectVerbatim(src: string): string {
    const envs = VERBATIM_ENVS.map((e) => e.replace('*', '\\*')).join('|')
    const re = new RegExp(`\\\\begin\\s*\\{(${envs})\\}`, 'g')
    let out = ''
    let last = 0
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const env = m[1]!
      let start = m.index + m[0].length
      let lang = ''
      const opt = src[start] === '[' && /^(lstlisting|minted|Verbatim)$/.test(env) ? readOptional(src, start) : null
      if (opt) start = opt.end
      if (env === 'minted') {
        const arg = readArg(src, start)
        if (arg) {
          lang = arg.value
          start = arg.end
        }
      }
      const endTag = `\\end{${env}}`
      const endAt = src.indexOf(endTag, start)
      const stop = endAt < 0 ? src.length : endAt
      const text = src.slice(start, stop).replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '')
      const langOpt = opt ? /language\s*=\s*([\w+#-]+)/.exec(opt.value)?.[1] : undefined
      this.raws.push({ env, lang: lang || langOpt || '', text })
      out += src.slice(last, m.index) + `\\velocityverbatim{${this.raws.length - 1}}`
      last = endAt < 0 ? src.length : endAt + endTag.length
      re.lastIndex = last
    }
    out += src.slice(last)
    // \verb|…| and \lstinline|…| (any delimiter).
    return out.replace(/\\(?:verb|lstinline)\*?(?:\[[^\]]*\])?([^\sA-Za-z{])([^\n]*?)\1/g, (_, _d: string, text: string) => {
      this.raws.push({ env: 'verb', lang: '', text })
      return `\\velocityverb{${this.raws.length - 1}}`
    })
  }

  private scanDefinitions(src: string) {
    const re = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def|newtheorem|title|author|date)\b\*?/g
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const kind = m[1]!
      let i = m.index + m[0].length
      if (kind === 'title' || kind === 'author' || kind === 'date') {
        const opt = readOptional(src, i)
        if (opt) i = opt.end
        const arg = readArg(src, i)
        if (arg) this.meta[kind] = arg.value
        continue
      }
      if (kind === 'newtheorem') {
        const name = readArg(src, i)
        if (!name) continue
        i = name.end
        const shared = readOptional(src, i)
        if (shared) i = shared.end
        const title = readArg(src, i)
        if (!title) continue
        this.theorems.set(name.value.trim(), { title: plainText(title.value), counter: shared?.value.trim() || name.value.trim() })
        continue
      }
      if (kind === 'def') {
        const name = /^\s*(\\[A-Za-z@]+)/.exec(src.slice(i))
        if (!name) continue
        i += name[0].length
        const params = /^(#\d)*/.exec(src.slice(i))?.[0] ?? ''
        i += params.length
        const body = readArg(src, i)
        if (!body) continue
        this.define(name[1]!, params.length / 2, undefined, body.value)
        continue
      }
      const name = readArg(src, i)
      if (!name) continue
      i = name.end
      if (kind === 'DeclareMathOperator') {
        const body = readArg(src, i)
        if (body) this.macros[name.value.trim()] = `\\operatorname${m[0].endsWith('*') ? '*' : ''}{${body.value}}`
        continue
      }
      const count = readOptional(src, i)
      if (count) i = count.end
      const optional = readOptional(src, i)
      if (optional) i = optional.end
      const body = readArg(src, i)
      if (!body) continue
      this.define(name.value.trim(), Number(count?.value) || 0, optional?.value, body.value)
    }
  }

  private define(name: string, args: number, optional: string | undefined, body: string) {
    if (!name.startsWith('\\')) return
    this.textMacros.set(name.slice(1), { args, optional, body })
    // KaTeX reads `#1` and treats an optional first argument as a normal one.
    this.macros[name] = body
  }

  // ---- blocks ---------------------------------------------------------------

  /** Render a run of text and group inline pieces into paragraphs. */
  private renderBlock(src: string): string {
    return paragraphs(this.renderInline(src))
  }

  private renderInline(src: string): string {
    let out = ''
    let i = 0
    while (i < src.length) {
      const c = src[i]!
      if (c === '\\') {
        const r = this.command(src, i)
        out += r.html
        i = r.end
        continue
      }
      if (c === '{') {
        const end = closeOf(src, i)
        const inner = end < 0 ? src.slice(i + 1) : src.slice(i + 1, end)
        out += this.renderInline(inner)
        i = end < 0 ? src.length : end + 1
        continue
      }
      if (c === '}') {
        i++
        continue
      }
      if (c === '$') {
        const display = src[i + 1] === '$'
        const open = display ? 2 : 1
        const close = findDollar(src, i + open, display)
        const tex = close < 0 ? src.slice(i + open) : src.slice(i + open, close)
        out += display ? block(this.displayMath(tex, false)) : this.math(tex, false)
        i = close < 0 ? src.length : close + open
        continue
      }
      if (c === '\n') {
        let j = i
        while (src[j + 1] === ' ' || src[j + 1] === '\t') j++
        if (src[j + 1] === '\n') {
          while (src[j + 1] === '\n' || src[j + 1] === ' ' || src[j + 1] === '\t') j++
          out += PAR
        } else out += ' '
        i = j + 1
        continue
      }
      if (c === '~') {
        out += '&nbsp;'
        i++
        continue
      }
      if (c === '-' && src[i + 1] === '-') {
        const em = src[i + 2] === '-'
        out += em ? '—' : '–'
        i += em ? 3 : 2
        continue
      }
      if (c === '`' || c === "'") {
        const double = src[i + 1] === c
        out += c === '`' ? (double ? '“' : '‘') : double ? '”' : '’'
        i += double ? 2 : 1
        continue
      }
      if (c === '&') {
        out += '&amp;'
        i++
        continue
      }
      if (c === '<' || c === '>' || c === '"') {
        out += escapeHtml(c)
        i++
        continue
      }
      if (c === '#' || c === '^' || c === '_') {
        out += escapeHtml(c)
        i++
        continue
      }
      // Plain text run.
      let j = i + 1
      while (j < src.length && !/[\\{}$\n~\-`'&<>"#^_]/.test(src[j]!)) j++
      out += src.slice(i, j)
      i = j
    }
    return out
  }

  private command(src: string, start: number): { html: string; end: number } {
    let i = start + 1
    let name: string
    if (isLetter(src[i])) {
      let j = i
      while (isLetter(src[j])) j++
      name = src.slice(i, j)
      i = j
    } else {
      name = src[i] ?? ''
      i++
    }
    const star = src[i] === '*' && isLetter(name[0]) ? (i++, true) : false
    const afterName = i
    // TeX eats spaces after a control word.
    if (isLetter(name[0])) i = skipSpace(src, i, false)

    const arg = () => {
      const a = readArg(src, i)
      if (!a) return ''
      i = a.end
      return a.value
    }
    const opt = () => {
      const o = readOptional(src, i)
      if (!o) return null
      i = o.end
      return o.value
    }
    const done = (html: string) => ({ html, end: i })

    // Escaped characters and spacing.
    if (!isLetter(name[0])) {
      i = afterName
      switch (name) {
        case '\\': {
          if (src[i] === '*') i++
          if (src[i] === '[') opt()
          return done('<br>')
        }
        case '[': {
          const close = src.indexOf('\\]', i)
          const tex = close < 0 ? src.slice(i) : src.slice(i, close)
          i = close < 0 ? src.length : close + 2
          return done(block(this.displayMath(tex, false)))
        }
        case '(': {
          const close = src.indexOf('\\)', i)
          const tex = close < 0 ? src.slice(i) : src.slice(i, close)
          i = close < 0 ? src.length : close + 2
          return done(this.math(tex, false))
        }
        case '%': case '$': case '#': case '_': case '{': case '}':
          return done(escapeHtml(name))
        case '&':
          return done('&amp;')
        case ' ': case '\n':
          return done(' ')
        case ',':
          return done(' ')
        case ';': case ':': case '>':
          return done(' ')
        case '!': case '/': case '@': case '-':
          return done('')
        default:
          if (ACCENTS[name]) return done(this.accent(name, src, i, (end) => (i = end)))
          return done(escapeHtml(name))
      }
    }
    if (ACCENTS[name] && name.length === 1) return done(this.accent(name, src, i, (end) => (i = end)))

    switch (name) {
      case 'velocityverbatim': {
        const n = Number(arg())
        const raw = this.raws[n]
        if (!raw || raw.env === 'comment') return done('')
        const lang = raw.lang ? ` data-lang="${escapeHtml(raw.lang)}"` : ''
        return done(block(`<pre class="ltx-verbatim"${lang}><code>${RAW}${n}${RAW}</code></pre>`))
      }
      case 'velocityverb':
        return done(`<code class="ltx-tt">${RAW}${Number(arg())}${RAW}</code>`)
      case 'begin':
        return this.environment(src, i)
      case 'end':
        arg() // stray \end
        return done('')
      case 'part': case 'chapter': case 'section': case 'subsection': case 'subsubsection':
      case 'paragraph': case 'subparagraph': {
        opt()
        return done(this.heading(name, star, arg()))
      }
      case 'maketitle':
        return done(block(this.titleBlock()))
      case 'tableofcontents':
        return done(block(`${HOLE}toc:${HOLE}`))
      case 'label': {
        const key = arg().trim()
        if (key) this.labels.set(key, this.currentLabel)
        return done(`<span id="ltx-label-${escapeHtml(slug(key))}"></span>`)
      }
      case 'ref': case 'pageref': case 'autoref': case 'cref': case 'Cref': case 'vref': case 'nameref':
        return done(`${HOLE}ref:${arg().trim()}${HOLE}`)
      case 'eqref':
        return done(`(${HOLE}ref:${arg().trim()}${HOLE})`)
      case 'cite': case 'citep': case 'citet': case 'parencite': case 'textcite': case 'autocite': {
        const note = opt()
        const second = opt()
        const keys = arg().split(',').map((k) => k.trim()).filter(Boolean)
        const post = second ?? note
        const inner = keys.map((k) => `${HOLE}cite:${k}${HOLE}`).join(', ')
        return done(`[${inner}${post ? `, ${this.renderInline(post)}` : ''}]`)
      }
      case 'footnote': {
        opt()
        const html = this.renderInline(arg())
        this.footnotes.push(html)
        const n = this.footnotes.length
        return done(`<sup class="ltx-fnmark"><a href="#ltx-fn-${n}" id="ltx-fnref-${n}">${n}</a></sup>`)
      }
      case 'href': {
        const url = arg()
        const text = this.renderInline(arg())
        const safe = safeUrl(url)
        return done(safe ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text)
      }
      case 'url': case 'nolinkurl': {
        const url = arg()
        const safe = safeUrl(url)
        const text = `<code class="ltx-url">${escapeHtml(url)}</code>`
        return done(safe && name === 'url' ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text)
      }
      case 'includegraphics': {
        const options = opt() ?? ''
        const file = arg().trim()
        const url = this.opts.resolveImage?.(file) ?? null
        const width = /width\s*=\s*([\d.]+)\s*\\(?:linewidth|textwidth|columnwidth)/.exec(options)
        const style = width ? ` style="width:${Math.min(100, Number(width[1]) * 100)}%"` : ''
        return done(
          url
            ? `<img class="ltx-img" src="${escapeHtml(url)}" alt="${escapeHtml(file)}"${style}>`
            : `<span class="ltx-imgph"${style}>${escapeHtml(file || 'image')}</span>`,
        )
      }
      case 'caption': {
        opt()
        const text = this.renderInline(arg())
        const kind = [...this.envStack].reverse().find((e) => e === 'figure' || e === 'table')
        if (!kind) return done(block(`<div class="ltx-caption">${text}</div>`))
        const n = this.bump(kind)
        this.currentLabel = String(n)
        return done(block(`<figcaption class="ltx-caption"><span class="ltx-caption-label">${kind === 'figure' ? 'Figure' : 'Table'} ${n}:</span> ${text}</figcaption>`))
      }
      case 'item':
        return done(opt() ?? '')
      case 'par':
        return done(PAR)
      case 'newline': case 'linebreak':
        return done('<br>')
      case 'newpage': case 'clearpage': case 'cleardoublepage': case 'pagebreak':
        return done(block('<hr class="ltx-pagebreak">'))
      case 'today':
        return done(formatDate(this.opts.today ?? new Date()))
      case 'LaTeX':
        return done('<span class="ltx-logo">L<sup>a</sup>T<sub>e</sub>X</span>')
      case 'LaTeXe':
        return done('<span class="ltx-logo">L<sup>a</sup>T<sub>e</sub>X&thinsp;2<sub>ε</sub></span>')
      case 'TeX':
        return done('<span class="ltx-logo">T<sub>e</sub>X</span>')
      case 'BibTeX':
        return done('<span class="ltx-logo">B<span class="ltx-sc">ib</span>T<sub>e</sub>X</span>')
      case 'input': case 'include': case 'subfile': case 'bibliography': {
        const file = arg()
        return done(`<span class="ltx-muted">[${escapeHtml(name)}: ${escapeHtml(file)}]</span>`)
      }
      case 'newcommand': case 'renewcommand': case 'providecommand': {
        arg()
        opt()
        opt()
        arg()
        return done('')
      }
      case 'DeclareMathOperator':
        arg()
        arg()
        return done('')
      case 'newtheorem':
        arg()
        opt()
        arg()
        opt()
        return done('')
      case 'def': {
        const m = /^\s*\\[A-Za-z@]+(#\d)*/.exec(src.slice(i))
        if (m) i += m[0].length
        arg()
        return done('')
      }
      case 'let': {
        const m = /^\s*\\[A-Za-z@]+\s*=?\s*\\[A-Za-z@]+/.exec(src.slice(i))
        if (m) i += m[0].length
        return done('')
      }
      case 'textcolor': {
        arg()
        return done(this.renderInline(arg()))
      }
      case 'colorbox': {
        arg()
        return done(`<span class="ltx-fbox">${this.renderInline(arg())}</span>`)
      }
      case 'raisebox': {
        arg()
        opt()
        opt()
        return done(this.renderInline(arg()))
      }
      case 'parbox': case 'minipagebox': {
        opt()
        arg()
        return done(this.renderInline(arg()))
      }
      case 'footnotemark': case 'footnotetext':
        opt()
        if (name === 'footnotetext') arg()
        return done('')
      case 'and':
        return done(' ') // only meaningful inside \author
    }

    if (INLINE_TAGS[name]) {
      if (name === 'makebox' || name === 'framebox') {
        opt()
        opt()
      }
      const [open, close] = INLINE_TAGS[name]
      return done(open + this.renderInline(arg()) + close)
    }
    if (DECLARATIONS[name] || SIZES.includes(name)) {
      const [open, close] = DECLARATIONS[name] ?? [`<span class="ltx-size-${name}">`, '</span>']
      // Style the rest of the current group (the caller passed us only that group).
      return { html: open + this.renderInline(src.slice(i)) + close, end: src.length }
    }
    if (name in SYMBOLS) return done(SYMBOLS[name]!)
    if (name in SILENT) {
      opt()
      for (let n = 0; n < SILENT[name]!; n++) {
        opt()
        arg()
      }
      return done('')
    }
    const macro = this.textMacros.get(name)
    if (macro && this.expansions < 2000) {
      this.expansions++
      const values: string[] = []
      for (let n = 0; n < macro.args; n++) {
        if (n === 0 && macro.optional !== undefined) values.push(opt() ?? macro.optional)
        else values.push(arg())
      }
      const body = macro.body.replace(/#(\d)/g, (_, d: string) => values[Number(d) - 1] ?? '')
      return done(this.renderInline(body))
    }
    this.unsupported.add(`\\${name}`)
    i = afterName
    return done(`<span class="ltx-unknown" title="Not shown in the live preview">\\${escapeHtml(name)}</span>`)
  }

  private accent(name: string, src: string, i: number, setEnd: (end: number) => void): string {
    const a = readArg(src, i)
    if (!a) return ''
    setEnd(a.end)
    const base = a.value === '\\i' ? 'i' : a.value === '\\j' ? 'j' : a.value
    return escapeHtml((base + ACCENTS[name]).normalize('NFC'))
  }

  private bump(counter: string): number {
    this.counters[counter] = (this.counters[counter] ?? 0) + 1
    return this.counters[counter]!
  }

  private heading(kind: string, star: boolean, titleTex: string): string {
    const levels = ['chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph']
    const title = this.renderInline(titleTex)
    if (kind === 'part') {
      return block(`<h1 class="ltx-part">${star ? '' : `Part ${toRoman(this.bump('part'))}<br>`}${title}</h1>`)
    }
    const level = levels.indexOf(kind)
    let number = ''
    if (!star && level <= 3 && (level > 0 || this.hasChapters)) {
      this.sectionCounters[level]!++
      for (let l = level + 1; l < this.sectionCounters.length; l++) this.sectionCounters[l] = 0
      const from = this.hasChapters ? 0 : 1
      number = this.sectionCounters.slice(from, level + 1).join('.')
      this.currentLabel = number
    }
    const id = `ltx-sec-${this.toc.length + 1}`
    if (level <= 3) this.toc.push({ level, number, title, id })
    const tag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'][level]
    const num = number ? `<span class="ltx-secnum">${kind === 'chapter' ? `Chapter ${number}` : number}</span> ` : ''
    if (kind === 'chapter') return block(`<${tag} id="${id}" class="ltx-chapter">${num}${num ? '<br>' : ''}${title}</${tag}>`)
    return block(`<${tag} id="${id}" class="ltx-${kind}">${num}${title}</${tag}>`)
  }

  private titleBlock(): string {
    const { title, author, date } = this.meta
    const parts: string[] = []
    if (title != null) parts.push(`<h1 class="ltx-title">${this.renderInline(title)}</h1>`)
    if (author != null && author.trim()) {
      const authors = author.split(/\\and\b/).map((a) => `<div class="ltx-author">${this.renderInline(a.trim())}</div>`)
      parts.push(`<div class="ltx-authors">${authors.join('')}</div>`)
    }
    const when = date ?? '\\today'
    if (when.trim()) parts.push(`<div class="ltx-date">${this.renderInline(when)}</div>`)
    return `<header class="ltx-titleblock">${parts.join('')}</header>`
  }

  // ---- environments ---------------------------------------------------------

  private environment(src: string, afterBegin: number): { html: string; end: number } {
    const nameArg = readArg(src, afterBegin)
    if (!nameArg) return { html: '', end: afterBegin }
    const env = nameArg.value.trim()
    const { bodyEnd, end } = findEnd(src, nameArg.end, env)
    this.envStack.push(env.replace(/\*$/, ''))
    try {
      return { html: this.environmentHtml(env, src.slice(nameArg.end, bodyEnd)), end }
    } finally {
      this.envStack.pop()
    }
  }

  private environmentHtml(env: string, body: string): string {
    const base = env.replace(/\*$/, '')
    const rest = () => body
    // Leading arguments of the environment (`\begin{tabular}{lcr}`), consumed from the body.
    const read = {
      opt: () => {
        const o = body.trimStart().startsWith('[') ? readOptional(body, 0) : null
        if (!o) return null
        body = body.slice(o.end)
        return o.value
      },
      arg: () => {
        const a = readArg(body, 0)
        if (!a) return ''
        body = body.slice(a.end)
        return a.value
      },
    }

    if (MATH_ENVS.has(base)) {
      if (base === 'alignat') read.arg()
      if (base === 'math') return this.math(rest(), false)
      return block(this.mathEnvironment(base, env.endsWith('*') || base === 'displaymath', rest()))
    }
    switch (base) {
      case 'itemize': case 'enumerate': case 'description': case 'compactitem': case 'compactenum': case 'inparaenum': {
        read.opt()
        return block(this.list(base, rest()))
      }
      case 'thebibliography': {
        read.arg()
        return block(this.bibliography(rest()))
      }
      case 'quote': case 'quotation': case 'verse':
        return block(`<blockquote class="ltx-${base}">${this.renderBlock(rest())}</blockquote>`)
      case 'center': case 'flushleft': case 'flushright':
        return block(`<div class="ltx-${base}">${this.renderBlock(rest())}</div>`)
      case 'abstract':
        return block(`<div class="ltx-abstract"><div class="ltx-abstract-title">Abstract</div>${this.renderBlock(rest())}</div>`)
      case 'figure': case 'table': case 'wrapfigure': case 'wraptable': case 'subfigure': {
        read.opt()
        if (base.startsWith('wrap')) read.arg()
        if (base === 'subfigure') read.arg()
        const inner = this.renderBlock(rest())
        return block(`<figure class="ltx-${base === 'wraptable' ? 'table' : base === 'wrapfigure' ? 'figure' : base}">${inner}</figure>`)
      }
      case 'tabular': case 'tabularx': case 'tabulary': case 'longtable': case 'array': case 'tabu': {
        if (base === 'tabularx' || base === 'tabulary') read.arg()
        read.opt()
        const spec = read.arg()
        return block(this.table(spec, rest()))
      }
      case 'minipage': {
        read.opt()
        read.arg()
        return block(`<div class="ltx-minipage">${this.renderBlock(rest())}</div>`)
      }
      case 'multicols': {
        const n = Math.max(1, Math.min(4, Number(read.arg()) || 2))
        return block(`<div class="ltx-multicols" style="column-count:${n}">${this.renderBlock(rest())}</div>`)
      }
      case 'proof': {
        const label = read.opt()
        return block(
          `<div class="ltx-proof"><em class="ltx-proof-title">${label ? this.renderInline(label) : 'Proof'}.</em> ${this.renderBlock(rest())}<span class="ltx-qed">∎</span></div>`,
        )
      }
      case 'document':
        return this.renderBlock(rest())
    }
    const theorem = this.theorems.get(base)
    if (theorem) {
      const label = read.opt()
      let number = ''
      if (!env.endsWith('*')) {
        number = String(this.bump(`thm:${theorem.counter}`))
        this.currentLabel = number
      }
      const head = `<span class="ltx-thm-title">${escapeHtml(theorem.title)}${number ? ` ${number}` : ''}${label ? ` (${this.renderInline(label)})` : ''}.</span>`
      return block(`<div class="ltx-theorem ltx-thm-${escapeHtml(base)}">${head} ${this.renderBlock(rest())}</div>`)
    }
    if (/^(tikzpicture|pgfpicture|picture|axis)$/.test(base)) {
      this.unsupported.add(`${base} environment`)
      return block(`<div class="ltx-imgph">${escapeHtml(base)} — shown in the PDF</div>`)
    }
    this.unsupported.add(`${base} environment`)
    return block(`<div class="ltx-env" data-env="${escapeHtml(base)}">${this.renderBlock(rest())}</div>`)
  }

  private list(kind: string, body: string): string {
    const { parts } = splitTop(body, itemSep)
    const items = parts.slice(1)
    const depth = this.envStack.filter((e) => e === 'enumerate').length
    const type = ['1', 'a', 'i', 'A'][(depth - 1) % 4]
    if (kind === 'description') {
      return `<dl class="ltx-description">${items
        .map((item) => {
          const o = readOptional(item, 0)
          const term = o ? this.renderInline(o.value) : ''
          return `<dt>${term}</dt><dd>${this.renderBlock(o ? item.slice(o.end) : item)}</dd>`
        })
        .join('')}</dl>`
    }
    const ordered = kind !== 'itemize' && kind !== 'compactitem'
    const lis = items.map((item, n) => {
      const o = readOptional(item, 0)
      const content = o && item.slice(0, o.end).trimStart().startsWith('[') ? item.slice(o.end) : item
      if (ordered) this.currentLabel = String(n + 1)
      if (o && content !== item) {
        return `<li class="ltx-custom"><span class="ltx-item-label">${this.renderInline(o.value)}</span>${this.renderBlock(content)}</li>`
      }
      return `<li>${this.renderBlock(content)}</li>`
    })
    return ordered ? `<ol type="${type}">${lis.join('')}</ol>` : `<ul>${lis.join('')}</ul>`
  }

  private bibliography(body: string): string {
    const { parts } = splitTop(body, bibSep)
    const items = parts.slice(1).map((item) => {
      let rest = item
      const o = readOptional(rest, 0)
      if (o) rest = rest.slice(o.end)
      const key = readArg(rest, 0)
      if (key) rest = rest.slice(key.end)
      const n = key ? this.cites.get(key.value.trim()) : undefined
      return `<li id="ltx-cite-${escapeHtml(slug(key?.value.trim() ?? ''))}" value="${n ?? ''}">${this.renderBlock(rest)}</li>`
    })
    return `<section class="ltx-bibliography"><h2>References</h2><ol>${items.join('')}</ol></section>`
  }

  private table(spec: string, body: string): string {
    const aligns: string[] = []
    let s = spec.replace(/\s+/g, '')
    s = s.replace(/\*\{(\d+)\}\{([^{}]*)\}/g, (_, n: string, cols: string) => cols.repeat(Math.min(50, Number(n))))
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!
      if (c === '{') {
        const end = closeOf(s, i)
        if (end > 0) i = end
        continue
      }
      if ('lcr'.includes(c)) aligns.push({ l: 'left', c: 'center', r: 'right' }[c]!)
      else if ('pmbXLCRJ'.includes(c)) aligns.push(c === 'C' ? 'center' : c === 'R' ? 'right' : 'left')
    }
    const rule = /^\s*(\\(?:hline|toprule|midrule|bottomrule|cline\s*\{[^}]*\}|cmidrule\s*(?:\([^)]*\))?\s*\{[^}]*\}|endhead|endfirsthead|endfoot|endlastfoot)\s*)+/
    const rows = splitTop(body, rowSep).parts
    const htmlRows: string[] = []
    let ruleAbove = false
    for (let row of rows) {
      const lead = rule.exec(row)
      if (lead) {
        ruleAbove = true
        row = row.slice(lead[0].length)
      }
      if (!row.trim()) continue
      const cells = splitTop(row, cellSep).parts
      let col = 0
      const tds = cells.map((cell) => {
        const multi = /^\s*\\multicolumn\s*\{(\d+)\}\s*\{([^}]*)\}/.exec(cell)
        let span = 1
        let align = aligns[col] ?? 'left'
        let content = cell
        if (multi) {
          span = Math.max(1, Number(multi[1]))
          const a = /[lcr]/.exec(multi[2]!)?.[0]
          if (a) align = { l: 'left', c: 'center', r: 'right' }[a]!
          const text = readArg(cell, multi.index + multi[0].length)
          content = text?.value ?? ''
        }
        col += span
        const attrs = `${span > 1 ? ` colspan="${span}"` : ''} style="text-align:${align}"`
        return `<td${attrs}>${this.renderInline(content.trim())}</td>`
      })
      htmlRows.push(`<tr${ruleAbove ? ' class="ltx-rule"' : ''}>${tds.join('')}</tr>`)
      ruleAbove = false
    }
    return `<div class="ltx-tablewrap"><table class="ltx-tabular"><tbody>${htmlRows.join('')}</tbody></table></div>`
  }

  // ---- maths ----------------------------------------------------------------

  private math(tex: string, display: boolean): string {
    return this.opts.math(tex, display, { ...this.macros })
  }

  /** `\label`s are ours (KaTeX doesn't know them); numbered rows get an explicit `\tag`. */
  private takeLabels(tex: string, number: string | null): string {
    return tex.replace(/\\label\s*\{([^}]*)\}/g, (_, key: string) => {
      if (number) this.labels.set(key.trim(), number)
      return ''
    })
  }

  private displayMath(tex: string, numbered: boolean): string {
    let number: string | null = null
    if (numbered && !/\\(nonumber|notag)\b/.test(tex) && !/\\tag\b/.test(tex)) number = String(this.bump('equation'))
    let body = this.takeLabels(tex, number).replace(/\\(nonumber|notag)\b/g, '')
    if (number) body += `\\tag{${number}}`
    return `<div class="ltx-display">${this.math(body, true)}</div>`
  }

  private mathEnvironment(base: string, starred: boolean, tex: string): string {
    if (base === 'equation' || base === 'displaymath') return this.displayMath(tex, !starred)
    const katexEnv = base === 'gather' || base === 'multline' ? 'gather*' : 'align*'
    let body = tex
    if (base === 'alignat' || base === 'flalign' || base === 'eqnarray' || base === 'align' || base === 'gather' || base === 'multline') {
      const { parts, seps } = splitTop(tex, rowSep)
      body = parts
        .map((row, n) => {
          const last = n === parts.length - 1
          if (last && !row.trim()) return ''
          const numbered = !starred && base !== 'multline' && !/\\(nonumber|notag)\b/.test(row) && !/\\tag\b/.test(row)
          const number = numbered ? String(this.bump('equation')) : null
          let out = this.takeLabels(row, number).replace(/\\(nonumber|notag)\b/g, '')
          if (number) out += `\\tag{${number}}`
          return out + (last ? '' : (seps[n]?.startsWith('\\\\') ? '\\\\' : ''))
        })
        .join('')
      if (base === 'multline' && !starred) {
        const number = String(this.bump('equation'))
        body = this.takeLabels(body, number) + `\\tag{${number}}`
      }
    }
    if (base === 'eqnarray') body = body.replace(/&\s*([=<>]|\\[a-z]+)\s*&/g, '&$1')
    return `<div class="ltx-display">${this.math(`\\begin{${katexEnv}}${body}\\end{${katexEnv}}`, true)}</div>`
  }

  // ---- references -------------------------------------------------------------

  private resolveHoles(html: string): string {
    return html.replace(new RegExp(`${HOLE}(ref|cite|toc):([^${HOLE}]*)${HOLE}`, 'g'), (_, kind: string, key: string) => {
      if (kind === 'toc') return this.tocHtml()
      if (kind === 'cite') {
        const n = this.cites.get(key)
        return n ? `<a href="#ltx-cite-${escapeHtml(slug(key))}" class="ltx-cite">${n}</a>` : `<span class="ltx-missing">${escapeHtml(key)}</span>`
      }
      const target = this.labels.get(key)
      if (target === undefined) return `<span class="ltx-missing" title="Undefined reference: ${escapeHtml(key)}">??</span>`
      return `<a href="#ltx-label-${escapeHtml(slug(key))}" class="ltx-ref">${escapeHtml(target || '??')}</a>`
    })
  }

  private tocHtml(): string {
    if (!this.toc.length) return ''
    const items = this.toc
      .map((e) => `<li class="ltx-toc-${e.level}"><a href="#${e.id}">${e.number ? `<span class="ltx-secnum">${e.number}</span> ` : ''}${e.title}</a></li>`)
      .join('')
    return `<nav class="ltx-toc"><h2>Contents</h2><ul>${items}</ul></nav>`
  }
}

function findDollar(src: string, from: number, display: boolean): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') {
      i++
      continue
    }
    if (src[i] === '$' && (!display || src[i + 1] === '$')) return i
    // A blank line ends a runaway inline formula (TeX would error).
    if (!display && src[i] === '\n' && src[i + 1] === '\n') return -1
  }
  return -1
}

function slug(key: string): string {
  return key.replace(/[^\w-]+/g, '_')
}

function toRoman(n: number): string {
  const table: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let out = ''
  for (const [v, s] of table) {
    while (n >= v) {
      out += s
      n -= v
    }
  }
  return out
}

/** Wrap top-level inline runs in `<p>`; blocks stay as they are. */
export function paragraphs(html: string): string {
  let out = ''
  let inline = ''
  let depth = 0
  const flush = () => {
    for (const para of inline.split(PAR)) {
      const text = para.trim()
      if (text && text !== '<br>') out += `<p>${text.replace(/^(<br>\s*)+|(\s*<br>)+$/g, '')}</p>`
    }
    inline = ''
  }
  for (const ch of html) {
    if (ch === BLOCK_START) {
      if (depth === 0) flush()
      depth++
      continue
    }
    if (ch === BLOCK_END) {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0) inline += ch
    else out += ch === PAR ? ' ' : ch
  }
  flush()
  return out
}

export function renderLatex(source: string, opts: RenderOptions): RenderResult {
  try {
    return new Renderer(opts).render(source)
  } catch (err) {
    // The preview must never take the tile down while the user is typing.
    console.error('[latex] preview failed:', err)
    return { html: `<pre class="ltx-verbatim">${escapeHtml(source)}</pre>`, title: null, unsupported: [] }
  }
}
