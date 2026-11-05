/** Pure helpers for LaTeX notes: detection, standalone sources, file names, the new-document template. */

/** True when the note is a full LaTeX document (or clearly LaTeX source). */
export function isLatexSource(content: string): boolean {
  return /\\documentclass\b|\\begin\s*\{document\}/.test(content)
}

const THEOREM_TITLES: Record<string, string> = {
  theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition', corollary: 'Corollary',
  definition: 'Definition', remark: 'Remark', example: 'Example', conjecture: 'Conjecture',
}

/**
 * A source a TeX engine accepts on its own. A full document is returned unchanged; a fragment
 * (just a body) is wrapped in an article preamble with the usual maths, graphics and link
 * packages, plus theorem definitions for the theorem environments it uses. `lineOffset` maps
 * engine line numbers back to the note: note line = engine line − lineOffset.
 */
export function standaloneSource(content: string): { source: string; lineOffset: number; wrapped: boolean } {
  if (isLatexSource(content)) return { source: content, lineOffset: 0, wrapped: false }
  const used = Object.keys(THEOREM_TITLES).filter((env) => new RegExp(`\\\\begin\\s*\\{${env}\\*?\\}`).test(content))
  const definesOwn = /\\newtheorem\b/.test(content)
  const preamble = [
    '\\documentclass[11pt]{article}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{amsmath,amssymb,amsthm}',
    '\\usepackage{graphicx}',
    '\\usepackage{hyperref}',
    ...(definesOwn ? [] : used.map((env) => `\\newtheorem{${env}}{${THEOREM_TITLES[env]}}`)),
    '\\begin{document}',
  ]
  const body = content.endsWith('\n') ? content : content + '\n'
  return { source: `${preamble.join('\n')}\n${body}\\end{document}\n`, lineOffset: preamble.length, wrapped: true }
}

/** A safe file name for the note: "My Paper: Draft" → "My-Paper-Draft.tex". */
export function exportName(title: string, ext: 'tex' | 'pdf'): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s.-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80)
  return `${base || 'document'}.${ext}`
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export function newDocumentTemplate(title: string, author: string): string {
  return `\\documentclass[11pt]{article}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\newtheorem{theorem}{Theorem}

\\title{${title}}
\\author{${author}}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
A short summary of the document.
\\end{abstract}

\\section{Introduction}
Write \\emph{prose} with inline maths such as $e^{i\\pi} + 1 = 0$, and
displayed equations:
\\begin{equation}
  \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}.
  \\label{eq:gauss}
\\end{equation}
Equation~\\eqref{eq:gauss} is numbered and can be referenced.

\\begin{theorem}[Pythagoras]
For a right triangle with legs $a, b$ and hypotenuse $c$, $a^2 + b^2 = c^2$.
\\end{theorem}

\\section{Lists and tables}
\\begin{itemize}
  \\item The live preview updates as you type.
  \\item Compile to PDF with the server's TeX engine.
\\end{itemize}

\\begin{table}[h]
  \\centering
  \\begin{tabular}{lcr}
    \\hline
    Left & Centre & Right \\\\
    \\hline
    1 & 2 & 3 \\\\
    \\hline
  \\end{tabular}
  \\caption{A small table.}
\\end{table}

\\end{document}
`
}
