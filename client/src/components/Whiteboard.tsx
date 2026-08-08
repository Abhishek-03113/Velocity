import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import '@excalidraw/excalidraw/index.css'
import { loadScene, saveScene, type BoardScene } from '../store/whiteboardStore'
import styles from './Whiteboard.module.css'

const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })),
)

interface WhiteboardProps {
  noteId: number
}

export default function Whiteboard({ noteId }: WhiteboardProps) {
  const [initial, setInitial] = useState<BoardScene | null | undefined>(undefined)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setInitial(loadScene(noteId))
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [noteId])

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveScene(noteId, {
          elements: [...elements],
          appState: {
            viewBackgroundColor: appState['viewBackgroundColor'],
            scrollX: appState['scrollX'],
            scrollY: appState['scrollY'],
            zoom: appState['zoom'],
          },
          files,
        })
      }, 500)
    },
    [noteId],
  )

  if (initial === undefined) {
    return <div className={styles.loading}>Loading board…</div>
  }

  return (
    <div className={styles.root}>
      <Suspense fallback={<div className={styles.loading}>Loading board…</div>}>
        <Excalidraw
          key={String(noteId)}
          theme="dark"
          initialData={
            initial
              ? {
                  elements: initial.elements as never,
                  appState: { ...(initial.appState as object), collaborators: new Map() } as never,
                  files: initial.files as never,
                  scrollToContent: true,
                }
              : { appState: { viewBackgroundColor: '#1e1e1e' } as never }
          }
          onChange={handleChange as never}
          UIOptions={{ canvasActions: { loadScene: false } }}
        />
      </Suspense>
    </div>
  )
}
