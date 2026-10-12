import dns from 'node:dns'
import net from 'node:net'

export type FetchPageErrorCode =
  | 'invalid_url'
  | 'blocked_host'
  | 'too_large'
  | 'unsupported_type'
  | 'upstream_status'
  | 'network'
  | 'timeout'

const STATUS_FOR: Record<FetchPageErrorCode, 400 | 403 | 413 | 415 | 502 | 504> = {
  invalid_url: 400,
  blocked_host: 403,
  too_large: 413,
  unsupported_type: 415,
  upstream_status: 502,
  network: 502,
  timeout: 504,
}

/** Error with a machine code and the HTTP status the API should answer with. */
export class FetchPageError extends Error {
  code: FetchPageErrorCode
  status: 400 | 403 | 413 | 415 | 502 | 504
  constructor(code: FetchPageErrorCode, message: string) {
    super(message)
    this.name = 'FetchPageError'
    this.code = code
    this.status = STATUS_FOR[code]
  }
}

export interface FetchPageOptions {
  maxBytes?: number
  timeoutMs?: number
  /** Allowed media types (lower-case, without parameters). */
  accept?: string[]
}

export interface FetchedPage {
  url: string
  finalUrl: string
  status: number
  contentType: string
  body: string
}

const USER_AGENT = 'Mozilla/5.0 (compatible; VelocityReader/1.0; +https://github.com/Abhishek-03113/Velocity)'
const DEFAULT_ACCEPT = ['text/html', 'application/xhtml+xml']
const MAX_HOPS = 5

/** Parses a dotted IPv4 into 4 octets, or null. */
function v4Octets(ip: string): number[] | null {
  if (net.isIPv4(ip) === false) return null
  return ip.split('.').map(Number)
}

function isPrivateV4([a, b]: number[]): boolean {
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/** Expands any IPv6 text form into 8 16-bit groups. */
function v6Groups(ip: string): number[] | null {
  let s = ip.split('%')[0]
  // Trailing dotted quad (::ffff:1.2.3.4) -> two hex groups.
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (m) {
    const o = v4Octets(m[2])
    if (!o) return null
    s = m[1] + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null
  const all = [...head, ...Array(fill).fill('0'), ...tail].map((h) => parseInt(h, 16))
  return all.length === 8 && all.every((n) => Number.isFinite(n)) ? all : null
}

/** True when the address is loopback / private / link-local / otherwise non-public. */
export function isBlockedAddress(ip: string): boolean {
  const o = v4Octets(ip)
  if (o) return isPrivateV4(o)
  const g = v6Groups(ip)
  if (!g) return true // unparseable: fail closed
  if (g.every((n) => n === 0)) return true // ::
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true // ::1
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d).
  const mapped = g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)
  if (mapped) return isPrivateV4([g[6] >> 8, g[6] & 0xff])
  return false
}

async function assertPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new FetchPageError('blocked_host', 'Host is not allowed')
  }
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new FetchPageError('blocked_host', 'Host is not allowed')
    return
  }
  let addrs: { address: string }[]
  try {
    addrs = await dns.promises.lookup(host, { all: true })
  } catch {
    throw new FetchPageError('network', `Could not resolve ${host}`)
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new FetchPageError('blocked_host', 'Host is not allowed')
  }
}

function parseUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new FetchPageError('invalid_url', 'Invalid URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new FetchPageError('invalid_url', 'Only http and https URLs are supported')
  }
  if (u.username || u.password) throw new FetchPageError('invalid_url', 'URLs with credentials are not allowed')
  return u
}

/** Reads at most `maxBytes` from the stream; aborts as soon as the cap is exceeded. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {})
    throw new FetchPageError('too_large', 'Page is too large')
  }
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new FetchPageError('too_large', 'Page is too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/**
 * Fetches a public web page as text. SSRF-guarded (every redirect hop is re-validated),
 * time- and size-limited. Set `PLUGIN_FETCH_ALLOW_PRIVATE=on` to allow private hosts (E2E/dev).
 */
export async function fetchPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<FetchedPage> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024
  const timeoutMs = opts.timeoutMs ?? 15_000
  const accept = (opts.accept ?? DEFAULT_ACCEPT).map((t) => t.toLowerCase())
  const allowPrivate = process.env.PLUGIN_FETCH_ALLOW_PRIVATE === 'on'
  const signal = AbortSignal.timeout(timeoutMs)

  let current = parseUrl(rawUrl)
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (!allowPrivate) await assertPublicHost(current.hostname)
      const res = await fetch(current, {
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': USER_AGENT, Accept: accept.join(', ') + ';q=1, */*;q=0.1' },
      })

      if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
        await res.body?.cancel().catch(() => {})
        let next: URL
        try {
          next = new URL(res.headers.get('location')!, current)
        } catch {
          throw new FetchPageError('network', 'Invalid redirect')
        }
        current = parseUrl(next.href)
        continue
      }

      if (res.status < 200 || res.status >= 300) {
        await res.body?.cancel().catch(() => {})
        throw new FetchPageError('upstream_status', `Site responded with status ${res.status}`)
      }

      const contentType = res.headers.get('content-type') ?? ''
      const mime = contentType.split(';')[0].trim().toLowerCase()
      if (!accept.includes(mime)) {
        await res.body?.cancel().catch(() => {})
        throw new FetchPageError('unsupported_type', `Unsupported content type${mime ? `: ${mime}` : ''}`)
      }

      const bytes = await readCapped(res, maxBytes)
      return {
        url: rawUrl,
        finalUrl: current.href,
        status: res.status,
        contentType,
        body: decode(bytes, contentType),
      }
    }
    throw new FetchPageError('network', 'Too many redirects')
  } catch (err) {
    if (err instanceof FetchPageError) throw err
    if (signal.aborted || (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError') {
      throw new FetchPageError('timeout', 'Timed out fetching the page')
    }
    throw new FetchPageError('network', 'Could not reach the site')
  }
}
