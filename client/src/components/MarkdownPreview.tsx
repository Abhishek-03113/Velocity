import { memo, useMemo } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { resolveMediaUrl } from '../lib/api'
import { toggleTask } from '../lib/markdownTasks'
import styles from './MarkdownPreview.module.css'

interface MarkdownPreviewProps {
  content: string | undefined
  /** Called with the toggled document when a checklist item is clicked. */
  onChange?: (content: string) => void
}

/** Point relative `/api/...` image srcs at the configured API origin. */
function rewriteMediaSrcs(html: string): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=")([^"]+)(")/gi,
    (_full, pre: string, src: string, post: string) => `${pre}${resolveMediaUrl(src)}${post}`,
  )
}

/** Read mode: typeset Markdown with the same measure and type scale as the editor. */
function MarkdownPreview({ content, onChange }: MarkdownPreviewProps) {
  const html = useMemo(() => {
    const raw = marked(content ?? '', { async: false, gfm: true }) as string
    // Notes can be imported or pasted from anywhere — never render script.
    const clean = DOMPurify.sanitize(rewriteMediaSrcs(raw), { ADD_ATTR: ['target'] })
    // marked renders task boxes disabled; enable them when the preview can write back.
    return onChange ? clean.replace(/(<input[^>]*?) disabled=""/g, '$1') : clean
  }, [content, onChange])

  return (
    <article className={styles.preview}>
      {content?.trim() ? (
        <div
          className={styles.body}
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(e) => {
            const target = e.target as HTMLElement
            if (!onChange || !(target instanceof HTMLInputElement) || target.type !== 'checkbox') return
            e.preventDefault()
            const boxes = Array.from(e.currentTarget.querySelectorAll('input[type="checkbox"]'))
            const index = boxes.indexOf(target)
            if (index >= 0 && content) onChange(toggleTask(content, index))
          }}
        />
      ) : (
        <p className={styles.empty}>This note is empty.</p>
      )}
    </article>
  )
}

export default memo(MarkdownPreview)
