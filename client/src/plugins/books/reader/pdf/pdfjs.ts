/**
 * The only module that imports pdf.js. Always lazy, so neither the library nor its worker is in the main chunk.
 */
export type PdfjsLib = typeof import('pdfjs-dist')

let loading: Promise<PdfjsLib> | null = null

export function loadPdfjs(): Promise<PdfjsLib> {
  if (!loading) {
    loading = (async () => {
      const lib = await import('pdfjs-dist')
      if (!lib.GlobalWorkerOptions.workerSrc) {
        const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        lib.GlobalWorkerOptions.workerSrc = workerUrl
      }
      return lib
    })()
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}
