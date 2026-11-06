import { lazy, memo, Suspense, useCallback } from 'react'
import { primaryKey } from '../../lib/commands'
import { displayTitle } from '../../lib/noteMeta'
import type { LeafNode } from '../../lib/tiling'
import { closeTile, focusTile, toggleReadMode } from '../../lib/workspace'
import { pluginName, pluginTileView, usePluginsVersion } from '../../plugins/host'
import { useEditorStore } from '../../store/editorStore'
import { useLayoutStore } from '../../store/layoutStore'
import { usePluginStore } from '../../store/pluginStore'
import { useUiStore } from '../../store/uiStore'
import Editor from '../Editor'
import { Icon, type IconName } from '../Icon'
import { ToolbarButton } from '../ui/ToolbarButton'
import { EmptyTile } from './EmptyTile'
import styles from './Workspace.module.css'

const Whiteboard = lazy(() => import('../Whiteboard'))
// Read mode pulls in marked + DOMPurify — only load them when someone reads.
const MarkdownPreview = lazy(() => import('../MarkdownPreview'))

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

interface TileProps {
  leaf: LeafNode
  focused: boolean
  tiled: boolean
  zoomed: boolean
  dropZone: DropZone | null
}

function TileTitle({ noteId, suffix, icon = 'doc.text' }: { noteId: number; suffix?: string; icon?: IconName }) {
  const title = useEditorStore((s) => {
    const p = s.pastes.find((x) => x.id === noteId)
    return p ? displayTitle(p) : 'Note'
  })
  const dirty = useEditorStore((s) => s.pastes.find((x) => x.id === noteId)?.dirty ?? false)
  return (
    <span className={styles.tileTitle}>
      <Icon name={icon} size={14} className={styles.tileTitleIcon} />
      <span className={styles.tileTitleText}>
        {title}
        {suffix && <span className={styles.tileTitleSuffix}> — {suffix}</span>}
      </span>
      {dirty && !suffix && <span className={styles.tileDirty} title="Saving…" />}
    </span>
  )
}

/** Header title of a plugin tile: the note title plus the view's name. */
function PluginTileTitle({ noteId, pluginId, view }: { noteId: number; pluginId: string; view: string }) {
  usePluginsVersion((s) => s.version)
  const spec = pluginTileView(pluginId, view)
  return <TileTitle noteId={noteId} suffix={spec?.title ?? pluginName(pluginId)} icon={spec?.icon ?? 'doc.plaintext'} />
}

function PluginTileBody({ tileId, noteId, pluginId, view }: { tileId: string; noteId: number; pluginId: string; view: string }) {
  // Re-resolve when plugins are switched on or off.
  usePluginsVersion((s) => s.version)
  const spec = pluginTileView(pluginId, view)
  if (!spec) {
    const name = pluginName(pluginId)
    return (
      <div className={styles.pluginOff}>
        <p className={styles.pluginOffText}>{name} is switched off.</p>
        <div className={styles.pluginOffActions}>
          <button type="button" className={styles.pluginOffPrimary} onClick={() => usePluginStore.getState().setEnabled(pluginId, true)}>
            Turn On {name}
          </button>
          <button type="button" className={styles.pluginOffButton} onClick={() => closeTile(tileId)}>
            Close Tile
          </button>
        </div>
      </div>
    )
  }
  return <>{spec.render(noteId)}</>
}

function tileLabel(kind: LeafNode['content']['kind']): string {
  switch (kind) {
    case 'board':
      return 'Whiteboard tile'
    case 'note':
      return 'Note tile'
    case 'plugin':
      return 'Plugin tile'
    default:
      return 'Empty tile'
  }
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
  return (
    <Suspense fallback={<NoteSkeleton />}>
      <MarkdownPreview content={content} onChange={onChange} />
    </Suspense>
  )
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
      aria-label={tileLabel(content.kind)}
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
          ) : content.kind === 'plugin' ? (
            <PluginTileTitle noteId={content.noteId} pluginId={content.pluginId} view={content.view} />
          ) : content.kind === 'board' ? (
            <TileTitle noteId={content.noteId} suffix="Whiteboard" icon="scribble" />
          ) : (
            <TileTitle noteId={content.noteId} />
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
        {content.kind === 'plugin' && (
          <PluginTileBody tileId={leaf.id} noteId={content.noteId} pluginId={content.pluginId} view={content.view} />
        )}
        {content.kind === 'empty' && <EmptyTile tileId={leaf.id} focused={focused} />}
      </div>

      {dropZone && <div className={`${styles.dropZone} ${styles[`drop_${dropZone}`]}`} aria-hidden="true" />}
    </section>
  )
}

export const Tile = memo(TileImpl)
