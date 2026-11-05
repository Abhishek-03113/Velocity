import { apiBaseUrl } from '../lib/api'
import type { RequestOptions, StreamHandlers } from './types'

/** An API error that keeps the HTTP status (e.g. 409 "needs you", 503 "connector off"). */
export class PluginApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PluginApiError'
  }
}

export async function pluginRequest<T>(pluginId: string, path: string, init: { method: string; body?: unknown }, opts: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}/api/plugins/${pluginId}${path}`, {
    method: init.method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  let json: { success?: boolean; data?: T; error?: string } = {}
  try {
    json = await res.json()
  } catch {
    // non-JSON error page
  }
  if (!res.ok || json.success === false) throw new PluginApiError(json.error ?? `HTTP ${res.status}`, res.status)
  return json.data as T
}

/** Parse an SSE byte stream into (event, data) pairs. Exported for tests. */
export function createSseParser(onEvent: (event: string, data: string) => void) {
  let buffer = ''
  let event = 'message'
  let data: string[] = []
  return (chunk: string) => {
    buffer += chunk
    let nl: number
    while ((nl = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + (buffer[nl] === '\r' ? 2 : 1))
      if (line === '') {
        if (data.length) onEvent(event, data.join('\n'))
        event = 'message'
        data = []
      } else if (line.startsWith(':')) {
        // comment / keep-alive
      } else {
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }
    }
  }
}

/** Read an SSE endpoint with fetch, reconnecting with back-off until stopped. */
export function pluginStream(pluginId: string, path: string, handlers: StreamHandlers, opts: RequestOptions = {}): () => void {
  let stopped = false
  let controller: AbortController | null = null
  let delay = 1000
  let timer: ReturnType<typeof setTimeout> | null = null

  const connect = async () => {
    if (stopped) return
    controller = new AbortController()
    try {
      const res = await fetch(`${apiBaseUrl()}/api/plugins/${pluginId}${path}`, {
        headers: { Accept: 'text/event-stream', ...(opts.headers ?? {}) },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        let message = `HTTP ${res.status}`
        try {
          message = ((await res.json()) as { error?: string }).error ?? message
        } catch {
          // keep the status
        }
        throw new PluginApiError(message, res.status)
      }
      delay = 1000
      handlers.onOpen?.()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const feed = createSseParser(handlers.onEvent)
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        feed(decoder.decode(value, { stream: true }))
      }
      if (!stopped) handlers.onError?.(new Error('The event stream closed'))
    } catch (err) {
      if (stopped) return
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)))
      // Wrong token or connector off: retrying won't help until settings change.
      if (err instanceof PluginApiError && (err.status === 401 || err.status === 503)) delay = 30_000
    }
    if (stopped) return
    timer = setTimeout(connect, delay)
    delay = Math.min(delay * 2, 30_000)
  }
  void connect()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    controller?.abort()
  }
}
