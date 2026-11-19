/** A problem TeX reported, pointed at a line of `main.tex` when the log says which. */
export interface LatexIssue {
  severity: 'error' | 'warning'
  message: string
  line?: number
}

const MAX_ISSUES = 50

/**
 * Pull errors and warnings out of a TeX log. Handles `-file-line-error` lines
 * (`./main.tex:12: Undefined control sequence.`), classic `! message` + `l.12` pairs,
 * and `LaTeX/Package/Class Warning:` paragraphs (`… on input line 12.`).
 */
export function parseLatexLog(log: string): LatexIssue[] {
  const lines = log.split(/\r?\n/)
  const issues: LatexIssue[] = []
  const seen = new Set<string>()
  const push = (issue: LatexIssue) => {
    const key = `${issue.severity}:${issue.line ?? ''}:${issue.message}`
    if (seen.has(key) || issues.length >= MAX_ISSUES) return
    seen.add(key)
    issues.push(issue)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    const fileLine = /^(?:\.\/)?([^\s:]+\.(?:tex|sty|cls)):(\d+): (.+)$/.exec(line)
    if (fileLine) {
      const [, file, num, message] = fileLine
      push({ severity: 'error', message: message!.trim(), line: file === 'main.tex' ? Number(num) : undefined })
      continue
    }

    const bang = /^! (.+)$/.exec(line)
    if (bang) {
      let lineNo: number | undefined
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const at = /^l\.(\d+)/.exec(lines[j]!)
        if (at) {
          lineNo = Number(at[1])
          break
        }
      }
      push({ severity: 'error', message: bang[1]!.trim(), line: lineNo })
      continue
    }

    const warning = /^((?:LaTeX|Package \S+|Class \S+|LaTeX Font) Warning): (.*)$/.exec(line)
    if (warning) {
      // Warnings wrap onto continuation lines indented under the "(package)" prefix.
      let message = warning[2]!.trim()
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]!
        if (next.trim() === '' || !/^\(\S+\)\s+/.test(next)) break
        message += ' ' + next.replace(/^\(\S+\)\s+/, '').trim()
        i = j
      }
      const at = /on input line (\d+)\.?/.exec(message)
      push({
        severity: 'warning',
        message: message.replace(/\s*on input line \d+\.?/, '').trim(),
        line: at ? Number(at[1]) : undefined,
      })
    }
  }
  // TeX's closing lines repeat that something failed; keep them only when nothing else says why.
  const echo = (i: LatexIssue) => i.severity === 'error' && /^(==> Fatal error occurred|Emergency stop)/.test(i.message)
  return issues.some((i) => i.severity === 'error' && !echo(i)) ? issues.filter((i) => !echo(i)) : issues
}

/** True when the log asks for another pass (cross-references, citations, page numbers). */
export function needsRerun(log: string): boolean {
  return /Rerun to get|Label\(s\) may have changed|Rerun LaTeX|Please rerun/i.test(log)
}
