import { useEditorStore } from '../../store/editorStore'
import { cachedContent } from '../../store/searchStore'
import type { NoteBadge, PluginContext, VelocityPlugin } from '../types'

const URLS_KEY = 'urls'
/** Note id → when it was marked read (ms). Absent = unread. */
const READ_KEY = 'read'
const MAX_REMEMBERED = 500

type NoteModule = typeof import('./note')

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Stable key for dedupe: no fragment, no utm_* tracking params. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim())
    u.hash = ''
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) u.searchParams.delete(key)
    }
    return u.toString()
  } catch {
    return raw.trim()
  }
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    return raw
  }
}

function reasonOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'unknown error'
}

interface FetchedPage {
  url: string
  finalUrl: string
  contentType: string
  html: string
}

const plugin: VelocityPlugin = {
  manifest: {
    id: 'blog-reader',
    name: 'Blog Reader',
    description: 'Open a blog post as a note, filed in your Blogs folder.',
    icon: 'book',
    version: '1.0.0',
  },
  settings: [
    { key: 'folder', type: 'text', label: 'Folder', hint: 'Where saved posts are filed', default: 'Blogs', placeholder: 'Blogs' },
    {
      key: 'openIn',
      type: 'choice',
      label: 'Open in',
      default: 'split',
      options: [
        { value: 'split', label: 'New tile' },
        { value: 'current', label: 'Current tile' },
      ],
    },
    { key: 'readMode', type: 'toggle', label: 'Open in Read mode', default: true },
    { key: 'images', type: 'toggle', label: 'Include images', default: true },
    {
      key: 'readStatus',
      type: 'toggle',
      label: 'Colour-code read status',
      hint: 'Blue for unread posts, green for read ones, in the notes list',
      default: true,
    },
  ],

  activate(ctx: PluginContext) {
    let noteModule: NoteModule | null = null
    let disposed = false
    const inFlight = new Set<string>()
    // Warm the small note helpers so `enabled()` and lookups can stay synchronous.
    void import('./note').then((m) => {
      noteModule = m
      if (!disposed) ctx.refreshBadges()
    })

    const remembered = () => {
      const map = ctx.storage.get<Record<string, number>>(URLS_KEY) ?? {}
      // A note created this session starts with a temp id (< 0); its `cid` survives the
      // server remap, so swap in the real id once the POST has landed.
      let changed = false
      for (const [url, id] of Object.entries(map)) {
        if (id >= 0) continue
        const real = useEditorStore.getState().pastes.find((p) => p.cid === `t${id}`)?.id
        if (real != null && real >= 0) {
          map[url] = real
          changed = true
        }
      }
      if (changed) {
        ctx.storage.set(URLS_KEY, map)
        rememberedIds = null
      }
      return map
    }
    const remember = (url: string, id: number) => {
      const map = remembered()
      delete map[url]
      map[url] = id
      if (id < 0) pendingTemp.add(id)
      const keys = Object.keys(map)
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete map[k]
      ctx.storage.set(URLS_KEY, map)
      rememberedIds = null
    }

    /** Existing note for this URL: the remembered id, else any note whose content names it as source. */
    // Persist real ids promptly so dedupe still works after a reload (contents load lazily).
    const pendingTemp = new Set<number>()
    const stopRemap = useEditorStore.subscribe((state, prev) => {
      if (pendingTemp.size === 0 || state.pastes === prev.pastes) return
      remembered()
      readMap()
      for (const id of pendingTemp) {
        if (!state.pastes.some((p) => p.cid === `t${id}` && p.id === id)) pendingTemp.delete(id)
      }
    })

    /** Ids of remembered notes (cached; reset whenever the URL map is written). */
    let rememberedIds: Set<number> | null = null
    /** Per-note memo of the source URL parsed from its content. */
    const sourceCache = new Map<number, { content: string; url: string | null }>()

    /** Whether a note is a Blog Reader post: remembered here, or its header names a source URL. */
    let indexed: { pastes: unknown; byId: Map<number, string | undefined> } | null = null
    const contentOf = (id: number): string | undefined => {
      const pastes = useEditorStore.getState().pastes
      if (indexed?.pastes !== pastes) indexed = { pastes, byId: new Map(pastes.map((p) => [p.id, p.content])) }
      return indexed.byId.get(id) ?? cachedContent(id)
    }
    const isBlogNote = (id: number): boolean => {
      const content = contentOf(id)
      if (content && noteModule) {
        const hit = sourceCache.get(id)
        if (hit?.content === content) return hit.url != null
        const url = noteModule.sourceUrlOf(content)
        sourceCache.set(id, { content, url })
        if (url) return true
      }
      rememberedIds ??= new Set(Object.values(remembered()))
      return rememberedIds.has(id)
    }

    // Read state, keyed by note id. A temp id (< 0) is re-keyed once the note has its server id.
    let readCache: Record<string, number> | null = null
    const readMap = (): Record<string, number> => {
      if (!readCache) {
        // Temp ids from an earlier session never got their server id; drop them.
        const stored = ctx.storage.get<Record<string, number>>(READ_KEY) ?? {}
        readCache = Object.fromEntries(Object.entries(stored).filter(([k]) => Number(k) >= 0))
      }
      const map = readCache
      if (pendingTemp.size === 0) return map
      let changed = false
      for (const [key, at] of Object.entries(map)) {
        const id = Number(key)
        if (id >= 0) continue
        const real = useEditorStore.getState().pastes.find((p) => p.cid === `t${id}`)?.id
        if (real != null && real >= 0) {
          delete map[key]
          map[real] = at
          changed = true
        }
      }
      if (changed) ctx.storage.set(READ_KEY, map)
      return map
    }
    const isRead = (id: number) => readMap()[id] != null
    const setRead = (id: number, read: boolean) => {
      const map = readMap()
      delete map[id]
      if (read) {
        map[id] = Date.now()
        if (id < 0) pendingTemp.add(id)
      }
      const keys = Object.keys(map)
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete map[k]
      ctx.storage.set(READ_KEY, map)
      ctx.refreshBadges()
    }
    const toggleRead = (id: number) => {
      const read = !isRead(id)
      setRead(id, read)
      ctx.flash(read ? 'Marked as read' : 'Marked as unread')
    }

    const noteBadge = (id: number): NoteBadge | null => {
      if (!ctx.setting<boolean>('readStatus') || !isBlogNote(id)) return null
      return isRead(id)
        ? { label: 'Read', tone: 'green', title: 'Mark as Unread', onClick: () => toggleRead(id) }
        : { label: 'Unread', tone: 'blue', title: 'Mark as Read', onClick: () => toggleRead(id) }
    }

    const findNote = (url: string): number | null => {
      const key = normalizeUrl(url)
      const id = remembered()[key]
      if (id != null && ctx.notes.exists(id)) return id
      if (!noteModule) return null
      for (const p of useEditorStore.getState().pastes) {
        const source = p.content ? noteModule.sourceUrlOf(p.content) : null
        if (source && normalizeUrl(source) === key) return p.id
      }
      return null
    }

    const sourceOfCurrent = (): { id: number; url: string } | null => {
      const id = ctx.notes.current()
      if (id == null) return null
      const entry = Object.entries(remembered()).find(([, v]) => v === id)
      if (entry) return { id, url: entry[0] }
      const content = useEditorStore.getState().pastes.find((p) => p.id === id)?.content
      const source = content && noteModule ? noteModule.sourceUrlOf(content) : null
      return source ? { id, url: source } : null
    }

    const load = async (url: string) => {
      const page = await ctx.api.get<FetchedPage>(`/fetch?url=${encodeURIComponent(url)}`)
      const [{ extractArticle }, { buildNote }] = await Promise.all([import('./extract'), import('./note')])
      const article = extractArticle(page.html, page.finalUrl || url, {
        images: ctx.setting<boolean>('images'),
      })
      return buildNote(article)
    }

    const open = async (rawUrl: string, invertSplit: boolean) => {
      const url = rawUrl.trim()
      const key = normalizeUrl(url)
      const folder = ctx.setting<string>('folder').trim() || 'Blogs'
      const mode = ctx.setting<boolean>('readMode') ? 'read' : 'edit'
      const split = (ctx.setting<string>('openIn') === 'split') !== invertSplit

      const existing = findNote(url)
      if (existing != null) {
        ctx.notes.open(existing, { split, mode })
        remember(key, existing)
        ctx.flash(`Already in ${folder}`)
        return
      }
      if (inFlight.has(key)) return
      inFlight.add(key)
      const host = hostOf(url)
      ctx.activity(`Fetching ${host}…`)
      try {
        const note = await load(url)
        if (disposed) return
        const id = ctx.notes.create({ title: note.title, content: note.content, folder, split, mode })
        remember(key, id)
        ctx.flash(`Saved “${note.title}” to ${folder}`)
      } catch (err) {
        ctx.flash(`Couldn’t open ${host}: ${reasonOf(err)}`)
      } finally {
        inFlight.delete(key)
        ctx.activity(null)
      }
    }

    const refresh = async () => {
      const source = sourceOfCurrent()
      if (!source) return
      const host = hostOf(source.url)
      ctx.activity(`Refreshing from ${host}…`)
      try {
        const note = await load(source.url)
        if (disposed || !ctx.notes.exists(source.id)) return
        const store = useEditorStore.getState()
        store.setTitle(source.id, note.title)
        store.setContent(note.content, source.id)
        ctx.flash(`Refreshed “${note.title}”`)
      } catch (err) {
        ctx.flash(`Couldn’t refresh ${host}: ${reasonOf(err)}`)
      } finally {
        ctx.activity(null)
      }
    }

    return {
      commands: [
        {
          id: 'open',
          title: 'Open Blog Post…',
          keys: ['Ctrl+Alt+KeyB'],
          keywords: 'url article read web clip import',
          run: () => {
            const inSplit = ctx.setting<string>('openIn') === 'split'
            ctx.prompt({
              title: 'Blog Reader',
              icon: 'book',
              placeholder: 'Paste a blog post URL…',
              validate: (v) => (isHttpUrl(v) ? null : 'Enter a full http(s) address, like https://example.com/post'),
              submitLabel: 'Open',
              splitLabel: inSplit ? 'Open in current tile' : 'Open beside',
              onSubmit: (value, opts) => void open(value, opts.split),
            })
          },
        },
        {
          id: 'refresh',
          title: 'Refresh Article',
          keywords: 'reload update fetch again',
          run: () => void refresh(),
          enabled: () => sourceOfCurrent() != null,
        },
        {
          id: 'toggleRead',
          title: 'Mark as Read / Unread',
          keys: ['Ctrl+Alt+Shift+KeyB'],
          keywords: 'read unread done finished seen toggle status colour color',
          run: () => {
            const id = ctx.notes.current()
            if (id != null) toggleRead(id)
          },
          enabled: () => {
            const id = ctx.notes.current()
            return id != null && isBlogNote(id)
          },
        },
      ],
      urlHandler: {
        label: 'Open in Blog Reader',
        match: (url) => url.protocol === 'http:' || url.protocol === 'https:',
        open: (url, opts) => void open(url, opts.split),
      },
      noteBadge,
      dispose: () => {
        disposed = true
        stopRemap()
      },
    }
  },
}

export default plugin
