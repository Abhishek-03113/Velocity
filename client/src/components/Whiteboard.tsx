import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import '@excalidraw/excalidraw/index.css'
import { loadScene, saveScene, type BoardScene } from '../store/whiteboardStore'
import { useUiStore } from '../store/uiStore'
import styles from './Whiteboard.module.css'

const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })),
)

interface WhiteboardProps {
  noteId: number
}

function Whiteboard({ noteId }: WhiteboardProps) {
  const theme = useUiStore((s) => s.resolvedTheme)
  const [initial, setInitial] = useState<BoardScene | null | undefined>(undefined)
  const pending = useRef<{ noteId: number; scene: BoardScene } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    if (pending.current) saveScene(pending.current.noteId, pending.current.scene)
    pending.current = null
  }, [])

  useEffect(() => {
    setInitial(loadScene(noteId))
    // Flush (not drop) the last strokes when the board closes or switches note.
    return flush
  }, [noteId, flush])

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      pending.current = {
        noteId,
        scene: {
          elements: [...elements],
          appState: {
            viewBackgroundColor: appState['viewBackgroundColor'],
            scrollX: appState['scrollX'],
            scrollY: appState['scrollY'],
            zoom: appState['zoom'],
          },
          files,
        },
      }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flush, 500)
    },
    [noteId, flush],
  )

  if (initial === undefined) {
    return <div className={styles.loading}>Loading board…</div>
  }

  return (
    <div className={styles.root}>
      <Suspense fallback={<div className={styles.loading}>Loading board…</div>}>
        <Excalidraw
          key={String(noteId)}
          theme={theme}
          initialData={
            initial
              ? {
                  elements: initial.elements as never,
                  appState: {
                    ...(initial.appState as object),
                    // Old boards stored a fixed dark canvas — let the theme decide.
                    viewBackgroundColor: undefined,
                    collaborators: new Map(),
                  } as never,
                  files: initial.files as never,
                  scrollToContent: true,
                }
              : undefined
          }
          onChange={handleChange as never}
          UIOptions={{ canvasActions: { loadScene: false, toggleTheme: false } }}
        />
      </Suspense>
    </div>
  )
}

export default memo(Whiteboard)
