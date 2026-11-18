import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BooksApiError, isBookFile, MSG_NOT_A_BOOK, MSG_TOO_LARGE, MSG_UNREACHABLE, uploadBook, uploadErrorMessage } from './api'

class FakeXhr {
  static last: FakeXhr | null = null
  headers: Record<string, string> = {}
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 0
  responseText = ''
  method = ''
  url = ''
  body: unknown = null
  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send(body: unknown) {
    this.body = body
  }
  abort() {
    this.onabort?.()
  }
  respond(status: number, json: unknown) {
    this.status = status
    this.responseText = JSON.stringify(json)
    this.onload?.()
  }
}

const file = new File(['%PDF-1.4'], 'Café Notes.pdf', { type: 'application/pdf' })

beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeXhr))
afterEach(() => vi.unstubAllGlobals())

describe('uploadErrorMessage', () => {
  it('maps statuses to friendly sentences', () => {
    expect(uploadErrorMessage(413)).toBe(MSG_TOO_LARGE)
    expect(uploadErrorMessage(415, 'Only EPUB and PDF files are supported')).toBe(MSG_NOT_A_BOOK)
    expect(uploadErrorMessage(0)).toBe(MSG_UNREACHABLE)
    expect(uploadErrorMessage(400, 'Empty file')).toBe('Empty file')
    expect(uploadErrorMessage(500)).toContain('500')
  })
})

describe('isBookFile', () => {
  it('accepts by extension or mime type', () => {
    expect(isBookFile({ name: 'a.EPUB', type: '' })).toBe(true)
    expect(isBookFile({ name: 'a', type: 'application/pdf' })).toBe(true)
    expect(isBookFile({ name: 'a.txt', type: 'text/plain' })).toBe(false)
  })
})

describe('uploadBook', () => {
  it('posts the raw file with its name and reports progress', async () => {
    const progress = vi.fn()
    const promise = uploadBook(file, progress)
    const xhr = FakeXhr.last!
    expect(xhr.method).toBe('POST')
    expect(xhr.headers['Content-Type']).toBe('application/pdf')
    expect(xhr.headers['X-File-Name']).toBe(encodeURIComponent('Café Notes.pdf'))
    expect(xhr.body).toBe(file)
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
    expect(progress).toHaveBeenLastCalledWith(0.5)
    xhr.respond(201, { success: true, data: { book: { id: 4 }, duplicate: false } })
    await expect(promise).resolves.toEqual({ book: { id: 4 }, duplicate: false })
    expect(progress).toHaveBeenLastCalledWith(1)
  })

  it('flags duplicates', async () => {
    const promise = uploadBook(file, () => {})
    FakeXhr.last!.respond(200, { success: true, data: { book: { id: 9 }, duplicate: true } })
    await expect(promise).resolves.toMatchObject({ duplicate: true })
  })

  it('maps failures to user-facing messages', async () => {
    const tooBig = uploadBook(file, () => {})
    FakeXhr.last!.respond(413, { success: false, error: 'Book exceeds 200 MB limit' })
    await expect(tooBig).rejects.toMatchObject({ message: MSG_TOO_LARGE, status: 413 })

    const wrong = uploadBook(file, () => {})
    FakeXhr.last!.respond(415, { success: false, error: 'Only EPUB and PDF files are supported' })
    await expect(wrong).rejects.toMatchObject({ message: MSG_NOT_A_BOOK })

    const down = uploadBook(file, () => {})
    FakeXhr.last!.onerror?.()
    await expect(down).rejects.toBeInstanceOf(BooksApiError)
    await expect(down).rejects.toMatchObject({ message: MSG_UNREACHABLE, status: 0 })

    const odd = uploadBook(file, () => {})
    FakeXhr.last!.respond(400, { success: false, error: 'File is empty' })
    await expect(odd).rejects.toMatchObject({ message: 'File is empty' })
  })

  it('aborts through the signal', async () => {
    const controller = new AbortController()
    const promise = uploadBook(file, () => {}, controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ message: 'Cancelled' })
  })
})
