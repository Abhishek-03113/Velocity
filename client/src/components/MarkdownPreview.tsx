import { useMemo } from 'react'
import { marked } from 'marked'
import styles from './MarkdownPreview.module.css'

interface MarkdownPreviewProps {
  content: string | undefined
}

export default function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(() => marked(content ?? '') as string, [content])

  return (
    <div
      className={styles.preview}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
