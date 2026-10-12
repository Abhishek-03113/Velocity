import { useEditorStore } from '../../store/editorStore'
import type { PluginContext, VelocityPlugin } from '../types'

const URLS_KEY = 'urls'
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
  ],

  activate(ctx: PluginContext) {
    let noteModule: NoteModule | null = null
    let disposed = false
    const inFlight = new Set<string>()
    // Warm the small note helpers so `enabled()` and lookups can stay synchronous.
    void import('./note').then((m) => {
      noteModule = m
    })

    const remembered = () => ctx.storage.get<Record<string, number>>(URLS_KEY) ?? {}
    const remember = (url: string, id: number) => {
      const map = remembered()
      delete map[url]
      map[url] = id
      const keys = Object.keys(map)
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete map[k]
      ctx.storage.set(URLS_KEY, map)
    }

    /** Existing note for this URL: the remembered id, else any note whose content names it as source. */
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
      ],
      urlHandler: {
        label: 'Open in Blog Reader',
        match: (url) => url.protocol === 'http:' || url.protocol === 'https:',
        open: (url, opts) => void open(url, opts.split),
      },
      dispose: () => {
        disposed = true
      },
    }
  },
}

export default plugin
