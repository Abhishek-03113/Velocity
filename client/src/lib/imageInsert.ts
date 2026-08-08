import type { EditorView } from '@codemirror/view'

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Failed to read image'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}

function altFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'image'
}

function insertImageMarkdown(view: EditorView, alt: string, dataUrl: string): void {
  const { from, to } = view.state.selection.main
  const before = from > 0 ? view.state.doc.sliceString(from - 1, from) : '\n'
  const prefix = before === '\n' || from === 0 ? '' : '\n'
  const markdown = `${prefix}![${alt}](${dataUrl})\n`
  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: { anchor: from + markdown.length },
  })
}

export async function insertImageFiles(
  view: EditorView,
  files: File[],
  onPersist: (dataUrl: string) => void,
): Promise<boolean> {
  const images = files.filter((f) => IMAGE_MIME.test(f.type))
  if (images.length === 0) return false

  for (const file of images) {
    try {
      const dataUrl = await readFileAsDataUrl(file)
      insertImageMarkdown(view, altFromFilename(file.name), dataUrl)
      onPersist(dataUrl)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error('[editor:image] insert failed:', message)
    }
  }
  return true
}
