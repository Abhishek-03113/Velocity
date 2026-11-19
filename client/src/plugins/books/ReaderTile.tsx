/**
 * Entry point of the Books reader tile. Deliberately tiny: the reader UI (ReaderView) and both engines
 * load lazily, so epub.js / pdf.js never reach the main chunk.
 */
import { createElement, lazy, Suspense } from 'react'
import type { PluginContext, TileView } from '../types'
import type { ReaderHost } from './types'

const ReaderView = lazy(() => import('./ReaderView'))

const fallbackStyle = {
  display: 'grid',
  placeItems: 'center',
  height: '100%',
  color: 'var(--label-tertiary)',
  fontSize: 'var(--text-callout)',
  background: 'var(--bg-content)',
} as const

/** The `reader` tile view: a book's note on one side, the book on the other. */
export function readerTileView(ctx: PluginContext, host: ReaderHost): TileView {
  return {
    title: 'Reader',
    icon: 'book',
    render: (noteId) =>
      createElement(
        Suspense,
        { fallback: createElement('div', { style: fallbackStyle, role: 'status' }, 'Opening…') },
        createElement(ReaderView, { noteId, ctx, host }),
      ),
  }
}
