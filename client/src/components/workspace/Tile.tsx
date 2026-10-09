import { lazy, memo, Suspense, useCallback } from 'react'
import { primaryKey } from '../../lib/commands'
import { displayTitle } from '../../lib/noteMeta'
import type { LeafNode } from '../../lib/tiling'
import { closeTile, focusTile, toggleReadMode } from '../../lib/workspace'
import { useEditorStore } from '../../store/editorStore'
import { useLayoutStore } from '../../store/layoutStore'
import { useUiStore } from '../../store/uiStore'
import Editor from '../Editor'
import { Icon } from '../Icon'
import MarkdownPreview from '../MarkdownPreview'
import { ToolbarButton } from '../ui/ToolbarButton'
import { EmptyTile } from './EmptyTile'
import styles from './Workspace.module.css'

const Whiteboard = lazy(() => import('../Whiteboard'))

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

interface TileProps {
  leaf: LeafNode
  focused: boolean
  tiled: boolean
  zoomed: boolean
  dropZone: DropZone | null
}

function TileTitle({ noteId, board }: { noteId: number; board: boolean }) {
  const title = useEditorStore((s) => {
    const p = s.pastes.find((x) => x.id === noteId)
    return p ? displayTitle(p) : 'Note'
  })
  const dirty = useEditorStore((s) => s.pastes.find((x) => x.id === noteId)?.dirty ?? false)
  return (
    <span className={styles.tileTitle}>
      <Icon name={board ? 'scribble' : 'doc.text'} size={14} className={styles.tileTitleIcon} />
      <span className={styles.tileTitleText}>
        {title}
        {board && <span className={styles.tileTitleSuffix}> — Whiteboard</span>}
      </span>
      {dirty && !board && <span className={styles.tileDirty} title="Saving…" />}
    </span>
  )
}

function NoteBody({ noteId, mode }: { noteId: number; mode: 'edit' | 'read' }) {
  const loaded = useEditorStore((s) => s.pastes.find((p) => p.id === noteId)?.content !== undefined)
  const cid = useEditorStore((s) => s.pastes.find((p) => p.id === noteId)?.cid)
  const spellcheck = useUiStore((s) => s.prefs.spellcheck)
  if (!loaded) return <NoteSkeleton />
  if (mode === 'read') return <ReadBody noteId={noteId} />
  return <Editor key={cid ?? noteId} noteId={noteId} spellcheck={spellcheck} />
}

function ReadBody({ noteId }: { noteId: number }) {
  const content = useEditorStore((s) => s.pastes.find((p) => p.id === noteId)?.content)
  const onChange = useCallback(
    (next: string) => useEditorStore.getState().setContent(next, noteId),
    [noteId],
  )
  return <MarkdownPreview content={content} onChange={onChange} />
}

function NoteSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading note">
      <span style={{ width: '46%', height: 26 }} />
      <span style={{ width: '88%' }} />
      <span style={{ width: '72%' }} />
      <span style={{ width: '80%' }} />
    </div>
  )
}

function TileImpl({ leaf, focused, tiled, zoomed, dropZone }: TileProps) {
  const { content } = leaf
  const showHeader = tiled || zoomed

  return (
    <section
      className={`${styles.tile} ${focused ? styles.tileFocused : ''} ${tiled ? styles.tileCard : ''}`}
      data-tile-id={leaf.id}
      data-tile-kind={content.kind}
      aria-label={content.kind === 'board' ? 'Whiteboard tile' : content.kind === 'note' ? 'Note tile' : 'Empty tile'}
      onPointerDownCapture={() => {
        if (!focused) focusTile(leaf.id)
      }}
      onFocusCapture={() => {
        if (!focused) focusTile(leaf.id)
      }}
    >
      {showHeader && (
        <header className={styles.tileHeader}>
          {content.kind === 'empty' ? (
            <span className={styles.tileTitle}>
              <Icon name="plus.circle" size={14} className={styles.tileTitleIcon} />
              <span className={styles.tileTitleText}>Open a Note</span>
            </span>
          ) : (
            <TileTitle noteId={content.noteId} board={content.kind === 'board'} />
          )}
          <div className={styles.tileActions}>
            {content.kind === 'note' && (
              <ToolbarButton
                size="small"
                icon={content.mode === 'edit' ? 'book' : 'pencil'}
                label={content.mode === 'edit' ? 'Read Mode' : 'Edit'}
                shortcut={primaryKey('view.read')}
                onClick={() => toggleReadMode(leaf.id)}
              />
            )}
            {zoomed && (
              <ToolbarButton
                size="small"
                icon="arrow.down.right.and.arrow.up.left"
                label="Exit Zoom"
                shortcut={primaryKey('tile.zoom')}
                onClick={() => useLayoutStore.getState().toggleZoom()}
              />
            )}
            <ToolbarButton
              size="small"
              icon="xmark"
              label="Close Tile"
              shortcut={primaryKey('tile.close')}
              onClick={() => closeTile(leaf.id)}
            />
          </div>
        </header>
      )}

      <div className={styles.tileBody} data-tile-body tabIndex={-1}>
        {content.kind === 'note' && <NoteBody noteId={content.noteId} mode={content.mode} />}
        {content.kind === 'board' && (
          <Suspense fallback={<div className={styles.boardLoading}>Loading whiteboard…</div>}>
            <Whiteboard noteId={content.noteId} />
          </Suspense>
        )}
        {content.kind === 'empty' && <EmptyTile tileId={leaf.id} focused={focused} />}
      </div>

      {dropZone && <div className={`${styles.dropZone} ${styles[`drop_${dropZone}`]}`} aria-hidden="true" />}
    </section>
  )
}

export const Tile = memo(TileImpl)
