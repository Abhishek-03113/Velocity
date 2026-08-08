import { useMemo } from 'react'
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
    (_full, pre: string, src: string, post: string) =>
      `${pre}${resolveMediaUrl(src)}${post}`,
  )
}

export default function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(
    () => rewriteMediaSrcs(marked(content ?? '') as string),
    [content],
  )

  return (
    <div
      className={styles.preview}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
