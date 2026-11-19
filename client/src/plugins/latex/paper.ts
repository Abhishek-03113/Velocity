import katexCss from 'katex/dist/katex.min.css?inline'
import paperCss from './paper.css?inline'

/** Paper is white whatever the app theme: the few tokens paper.css reads, fixed for print. */
const PRINT_TOKENS = `@page{margin:2.2cm}
:root{--label:#000;--label-secondary:#333;--label-tertiary:#666;--separator:#bbb;--fill-tertiary:#f2f2f2;--bg-code:#f5f5f5;--accent:#0645ad;--system-red:#c00;--font-serif:"Latin Modern Roman","Computer Modern Serif","Times New Roman",serif;--font-mono:ui-monospace,Menlo,monospace}
html,body{margin:0;background:#fff}
.ltx-page{max-width:none;padding:0}`

/**
 * Print the live preview (the browser's "Save as PDF"). Used for PDF export when the server
 * has no TeX engine. A hidden iframe, so the app's own UI isn't printed.
 */
export function printPreview(html: string, title: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc || !win) {
    frame.remove()
    return
  }
  const escapedTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapedTitle}</title>
<style>${katexCss}</style><style>${paperCss}</style>
<style>${PRINT_TOKENS}</style>
</head><body><article class="ltx-page ltx-print">${html}</article></body></html>`)
  doc.close()
  const go = () => {
    win.focus()
    win.print()
    // Give the print dialog time to read the document before removing it.
    setTimeout(() => frame.remove(), 60_000)
  }
  // Wait for KaTeX fonts so maths prints with the right glyphs.
  void (doc.fonts?.ready ?? Promise.resolve()).then(() => setTimeout(go, 50))
}

/** Inject the preview stylesheets once (KaTeX + paper typography). */
export function ensurePreviewStyles(): void {
  if (document.getElementById('velocity-latex-styles')) return
  const style = document.createElement('style')
  style.id = 'velocity-latex-styles'
  style.textContent = `${katexCss}\n${paperCss}`
  document.head.appendChild(style)
}
