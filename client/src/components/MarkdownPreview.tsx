import { memo, useMemo } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { resolveMediaUrl } from '../lib/api'
import styles from './MarkdownPreview.module.css'

interface MarkdownPreviewProps {
  content: string | undefined
}

/** Point relative `/api/...` image srcs at the configured API origin. */
function rewriteMediaSrcs(html: string): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=")([^"]+)(")/gi,
    (_full, pre: string, src: string, post: string) => `${pre}${resolveMediaUrl(src)}${post}`,
  )
}

/** Read mode: typeset Markdown with the same measure and type scale as the editor. */
function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(() => {
    const raw = marked(content ?? '', { async: false, gfm: true }) as string
    // Notes can be imported or pasted from anywhere — never render script.
    return DOMPurify.sanitize(rewriteMediaSrcs(raw), { ADD_ATTR: ['target'] })
  }, [content])

  return (
    <article className={styles.preview}>
      {content?.trim() ? (
        <div className={styles.body} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className={styles.empty}>This note is empty.</p>
      )}
    </article>
  )
}

export default memo(MarkdownPreview)
