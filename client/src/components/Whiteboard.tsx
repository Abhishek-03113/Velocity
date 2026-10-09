import { lazy, memo, Suspense, useCallback, useEffect, useState } from 'react'
import '@excalidraw/excalidraw/index.css'
import { flushScene, loadScene, peekScene, saveScene, type BoardScene } from '../store/whiteboardStore'
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
  // `id` guards against showing a previous note's scene for a render after switching.
  const [state, setState] = useState<{ id: number; scene: BoardScene | null } | 'error' | undefined>(() => {
    const hit = peekScene(noteId)
    return hit === undefined ? undefined : { id: noteId, scene: hit }
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const hit = peekScene(noteId)
    if (hit !== undefined) {
      setState({ id: noteId, scene: hit })
    } else {
      setState(undefined)
      loadScene(noteId)
        .then((scene) => !cancelled && setState({ id: noteId, scene }))
        .catch(() => !cancelled && setState('error'))
    }
    // Send the last strokes right away when the board closes or switches note.
    return () => {
      cancelled = true
      flushScene(noteId)
    }
  }, [noteId, attempt])

  useEffect(() => {
    if (state !== 'error') return
    const retry = () => setAttempt((n) => n + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [state])

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
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
    },
    [noteId],
  )

  if (state === 'error') {
    return (
      <div className={styles.loading}>
        Couldn’t load this board.{' '}
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    )
  }
  if (state === undefined || state.id !== noteId) {
    return <div className={styles.loading}>Loading board…</div>
  }
  const initial = state.scene

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
