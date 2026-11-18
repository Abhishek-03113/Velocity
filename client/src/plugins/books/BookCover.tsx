import { useState } from 'react'
import { coverSrc } from './api'
import styles from './Bookshelf.module.css'
import type { Book } from './types'

const COVER_COLORS = ['blue', 'indigo', 'purple', 'pink', 'red', 'orange', 'teal', 'green'] as const

/** Stable pick among the system colours from the title. */
function coverColor(title: string): (typeof COVER_COLORS)[number] {
  let hash = 0
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0
  return COVER_COLORS[hash % COVER_COLORS.length]!
}

/** A 2:3 cover: the book's own art, or a generated one (system colour, serif title and author). */
export function BookCover({ book }: { book: Pick<Book, 'title' | 'author' | 'cover_url'> }) {
  const src = coverSrc(book)
  const [failed, setFailed] = useState<string | null>(null)
  const showImage = src != null && failed !== src
  return (
    <div className={styles.cover} aria-hidden="true">
      {showImage ? (
        <img className={styles.coverImage} src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(src)} />
      ) : (
        <div className={styles.generated} style={{ background: `var(--system-${coverColor(book.title)})` }}>
          <span className={styles.generatedTitle}>{book.title}</span>
          {book.author && <span className={styles.generatedAuthor}>{book.author}</span>}
        </div>
      )}
      <span className={styles.spine} />
    </div>
  )
}
