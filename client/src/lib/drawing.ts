export type DrawingScene = {
  type: 'excalidraw'
  elements: unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

export function createDrawing() {
  return JSON.stringify({ type: 'excalidraw', elements: [] })
}

export function parseDrawing(content: string | undefined): DrawingScene | null {
  if (!content) return null
  try {
    const drawing = JSON.parse(content) as DrawingScene
    return drawing.type === 'excalidraw' && Array.isArray(drawing.elements) ? drawing : null
  } catch {
    return null
  }
}
