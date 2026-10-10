const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/

/** Flip the n-th task checkbox in source order (skipping fenced code), as marked renders them. */
export function toggleTask(content: string, index: number): string {
  const lines = content.split('\n')
  let inFence = false
  let seen = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue
    const m = TASK_LINE.exec(line)
    if (!m) continue
    if (seen === index) {
      const mark = m[2] === ' ' ? 'x' : ' '
      lines[i] = `${m[1]}[${mark}]${line.slice(m[0].length)}`
      return lines.join('\n')
    }
    seen++
  }
  return content
}
