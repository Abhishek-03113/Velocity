import katex from 'katex'
import { describe, expect, it } from 'vitest'
import { renderLatex, stripComments, type RenderOptions } from './render'

const katexMath: RenderOptions['math'] = (tex, display, macros) =>
  katex.renderToString(tex, { displayMode: display, throwOnError: false, macros })

/** Records the TeX handed to the maths renderer instead of rendering it. */
function recorder() {
  const calls: { tex: string; display: boolean }[] = []
  const math: RenderOptions['math'] = (tex, display) => {
    calls.push({ tex, display })
    return `<m>${tex}</m>`
  }
  return { calls, math }
}

const today = new Date(2026, 10, 5)
const html = (src: string, opts: Partial<RenderOptions> = {}) => renderLatex(src, { math: recorder().math, today, ...opts }).html

describe('latex preview', () => {
  it('renders a full document: title block, numbered sections, paragraphs', () => {
    const out = renderLatex(
      [
        '\\documentclass{article}',
        '\\usepackage{amsmath}',
        '\\title{On \\emph{Velocity}}',
        '\\author{Ada \\and Grace}',
        '\\begin{document}',
        '\\maketitle',
        '\\section{Intro}',
        'First paragraph',
        'continues here.',
        '',
        'Second -- with ``quotes\'\' and~a tie.',
        '\\subsection*{Aside}',
        '\\section{Next}',
        '\\end{document}',
        'ignored after end',
      ].join('\n'),
      { math: recorder().math, today },
    )
    expect(out.title).toBe('On Velocity')
    expect(out.html).toContain('<h1 class="ltx-title">On <em>Velocity</em></h1>')
    expect(out.html).toContain('<div class="ltx-author">Ada</div><div class="ltx-author">Grace</div>')
    expect(out.html).toContain('<div class="ltx-date">November 5, 2026</div>')
    expect(out.html).toContain('<span class="ltx-secnum">1</span> Intro</h2>')
    expect(out.html).toContain('<h3 id="ltx-sec-2" class="ltx-subsection">Aside</h3>')
    expect(out.html).toContain('<span class="ltx-secnum">2</span> Next')
    expect(out.html).toContain('<p>First paragraph continues here.</p>')
    expect(out.html).toContain('<p>Second – with “quotes” and&nbsp;a tie.</p>')
    expect(out.html).not.toContain('ignored after end')
    expect(out.html).not.toContain('usepackage')
  })

  it('treats a fragment without \\begin{document} as the body', () => {
    expect(html('Hello \\textbf{world}')).toBe('<p>Hello <strong>world</strong></p>')
  })

  it('strips comments but keeps escaped percent signs', () => {
    expect(stripComments('50\\% done % todo\nnext\n% whole line\n%again\nlast')).toBe('50\\% done next\nlast')
    expect(html('50\\% done % hidden')).toBe('<p>50% done</p>')
  })

  it('sends inline and display maths to KaTeX with user macros', () => {
    const rec = recorder()
    renderLatex('\\newcommand{\\R}{\\mathbb{R}}\nLet $x \\in \\R$ and \\(y\\).\n\\[ a^2 \\]\n$$b$$', { math: rec.math })
    expect(rec.calls).toEqual([
      { tex: 'x \\in \\R', display: false },
      { tex: 'y', display: false },
      { tex: ' a^2 ', display: true },
      { tex: 'b', display: true },
    ])
    const real = renderLatex('\\newcommand{\\R}{\\mathbb{R}}$x \\in \\R$', { math: katexMath }).html
    expect(real).toContain('class="katex"')
    expect(real).not.toContain('katex-error')
  })

  it('numbers equations, resolves \\label / \\ref / \\eqref, and skips starred or \\nonumber rows', () => {
    const rec = recorder()
    const out = renderLatex(
      [
        '\\begin{equation}\\label{eq:a} a = b \\end{equation}',
        '\\begin{equation*} c \\end{equation*}',
        '\\begin{align} x &= 1 \\label{eq:x} \\\\ y &= 2 \\nonumber \\\\ z &= 3 \\end{align}',
        'See \\eqref{eq:a}, \\ref{eq:x} and \\ref{nope}.',
      ].join('\n'),
      { math: rec.math },
    )
    expect(rec.calls.map((c) => c.tex)).toEqual([
      ' a = b \\tag{1}',
      ' c ',
      '\\begin{align*} x &= 1  \\tag{2}\\\\ y &= 2  \\\\ z &= 3 \\tag{3}\\end{align*}',
    ])
    expect(out.html).toContain('(<a href="#ltx-label-eq_a" class="ltx-ref">1</a>)')
    expect(out.html).toContain('<a href="#ltx-label-eq_x" class="ltx-ref">2</a>')
    expect(out.html).toContain('title="Undefined reference: nope">??</span>')
    // The real thing renders without KaTeX errors.
    const real = renderLatex('\\begin{align} x &= 1 \\label{a} \\\\ y &= 2 \\end{align}\\begin{multline} a \\\\ b \\end{multline}', { math: katexMath })
    expect(real.html).not.toContain('katex-error')
  })

  it('renders nested lists, description lists and custom item labels', () => {
    const out = html(
      '\\begin{enumerate}\n\\item One\n\\item Two\n\\begin{enumerate}\\item Inner\\end{enumerate}\n\\end{enumerate}\n' +
        '\\begin{itemize}\\item[--] Dash\\end{itemize}\n\\begin{description}\\item[Term] Def\\end{description}',
    )
    expect(out).toContain('<ol type="1"><li><p>One</p></li><li><p>Two</p><ol type="a"><li><p>Inner</p></li></ol></li></ol>')
    expect(out).toContain('<li class="ltx-custom"><span class="ltx-item-label">–</span><p>Dash</p></li>')
    expect(out).toContain('<dl class="ltx-description"><dt>Term</dt><dd><p>Def</p></dd></dl>')
  })

  it('renders tables with alignment, rules and multicolumn, and numbers captions', () => {
    const out = html(
      '\\begin{table}[h]\\centering\n\\begin{tabular}{|l|c|r|}\n\\hline\nA & B & C \\\\\n\\multicolumn{2}{c}{wide} & 3\\% \\\\\n\\hline\n\\end{tabular}\n\\caption{Results}\\label{tab:r}\n\\end{table}\nTable~\\ref{tab:r}.',
    )
    expect(out).toContain('<tr class="ltx-rule"><td style="text-align:left">A</td><td style="text-align:center">B</td><td style="text-align:right">C</td></tr>')
    expect(out).toContain('<td colspan="2" style="text-align:center">wide</td><td style="text-align:right">3%</td>')
    expect(out).toContain('<span class="ltx-caption-label">Table 1:</span> Results')
    expect(out).toContain('Table&nbsp;<a href="#ltx-label-tab_r" class="ltx-ref">1</a>.')
  })

  it('keeps verbatim text exactly, escaped, with comments and specials intact', () => {
    const out = html('\\begin{verbatim}\n<b>50% & \\x</b>\n\\end{verbatim}\nInline \\verb|a%b| ok')
    expect(out).toContain('<pre class="ltx-verbatim"><code>&lt;b&gt;50% &amp; \\x&lt;/b&gt;</code></pre>')
    expect(out).toContain('<code class="ltx-tt">a%b</code> ok')
    expect(html('\\begin{lstlisting}[language=Python]\nprint(1)\n\\end{lstlisting}')).toContain('data-lang="Python"')
  })

  it('escapes HTML in text and only links safe URLs', () => {
    const out = html('<script>alert(1)</script> \\href{javascript:alert(1)}{click} \\url{https://a.dev/x}')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('<a href="https://a.dev/x" target="_blank" rel="noopener noreferrer"><code class="ltx-url">https://a.dev/x</code></a>')
  })

  it('footnotes, citations with a bibliography, theorems and proofs', () => {
    const out = html(
      'Claim\\footnote{A note.} by \\cite{knuth}.\n\\begin{theorem}[Main]\\label{t}True.\\end{theorem}\n\\begin{proof}Easy.\\end{proof}\nBy Theorem~\\ref{t}.\n' +
        '\\begin{thebibliography}{9}\\bibitem{knuth} D. Knuth.\\end{thebibliography}',
    )
    expect(out).toContain('<sup class="ltx-fnmark"><a href="#ltx-fn-1" id="ltx-fnref-1">1</a></sup>')
    expect(out).toContain('<li id="ltx-fn-1">A note.')
    expect(out).toContain('[<a href="#ltx-cite-knuth" class="ltx-cite">1</a>]')
    expect(out).toContain('<span class="ltx-thm-title">Theorem 1 (Main).</span>')
    expect(out).toContain('<em class="ltx-proof-title">Proof.</em>')
    expect(out).toContain('Theorem&nbsp;<a href="#ltx-label-t" class="ltx-ref">1</a>')
    expect(out).toContain('<li id="ltx-cite-knuth" value="1"><p>D. Knuth.</p></li>')
  })

  it('expands user text macros with arguments, accents and declarations', () => {
    expect(html('\\newcommand{\\hi}[1]{Hello, \\textbf{#1}!}\\hi{you}')).toBe('<p>Hello, <strong>you</strong>!</p>')
    expect(html("Caf\\'e na\\\"{\\i}ve")).toBe('<p>Café naïve</p>')
    expect(html('{\\bfseries bold} plain')).toBe('<p><strong>bold</strong> plain</p>')
  })

  it('shows unknown commands muted and reports them, and survives unbalanced input', () => {
    const out = renderLatex('\\frobnicate{x} \\textbf{open', { math: recorder().math })
    expect(out.html).toContain('<span class="ltx-unknown" title="Not shown in the live preview">\\frobnicate</span>')
    expect(out.unsupported).toEqual(['\\frobnicate'])
    expect(out.html).toContain('<strong>open</strong>')
    expect(() => renderLatex('\\begin{itemize}\\item $x', { math: katexMath })).not.toThrow()
  })

  it('table of contents lists numbered sections', () => {
    const out = html('\\tableofcontents\n\\section{A}\\subsection{B}')
    expect(out).toContain('<nav class="ltx-toc"><h2>Contents</h2><ul><li class="ltx-toc-1"><a href="#ltx-sec-1"><span class="ltx-secnum">1</span> A</a></li><li class="ltx-toc-2"><a href="#ltx-sec-2"><span class="ltx-secnum">1.1</span> B</a></li></ul></nav>')
  })

  it('resolves images through the option and falls back to a placeholder', () => {
    const resolveImage = (p: string) => (p.startsWith('https://') ? p : null)
    expect(html('\\includegraphics[width=0.5\\linewidth]{https://x.dev/a.png}', { resolveImage })).toContain(
      '<img class="ltx-img" src="https://x.dev/a.png" alt="https://x.dev/a.png" style="width:50%">',
    )
    expect(html('\\includegraphics{plot.pdf}', { resolveImage })).toContain('<span class="ltx-imgph">plot.pdf</span>')
  })
})
