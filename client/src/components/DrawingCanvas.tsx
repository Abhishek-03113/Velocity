import { useCallback, useRef } from 'react'
import { Excalidraw, restore, serializeAsJSON } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { DrawingScene } from '../lib/drawing'
import styles from './DrawingCanvas.module.css'

interface DrawingCanvasProps {
  drawing: DrawingScene
  onChange: (content: string) => void
}

export default function DrawingCanvas({ drawing, onChange }: DrawingCanvasProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const initialData = useRef(restore(drawing as never, null, null)).current
  const handleChange = useCallback((elements: unknown, appState: unknown, files: unknown) => {
    onChangeRef.current(serializeAsJSON(elements as never, appState as never, files as never, 'local'))
  }, [])

  return (
    <div className={styles.canvas}>
      <Excalidraw
        initialData={initialData}
        onChange={handleChange}
      />
    </div>
  )
}
