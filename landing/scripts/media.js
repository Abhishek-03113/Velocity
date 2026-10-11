/**
 * Media map: the single place that knows which clips and stills exist.
 *
 * Clips (landing/media/<name>.mp4, .webm, <name>-poster.webp) and stills (<name>.webp) are
 * referenced from markup as <div class="media" data-media="<name>">. Swapping or adding
 * media only touches this file and the media folder.
 */

export const MEDIA_BASE = 'media/'

export const MEDIA = {
  // clips
  hero: { alt: 'Velocity with three notes tiled side by side, a command palette open on top.' },
  palette: { alt: 'The command palette filtering commands as you type.' },
  tiling: { alt: 'Notes splitting into dwindle tiles with the keyboard.' },
  sliding: { alt: 'Columns scrolling sideways in sliding tiling mode.' },
  themes: { alt: 'Switching colour themes across Apple, Catppuccin, Gruvbox and more.' },
  whiteboard: { alt: 'Drawing on an Excalidraw whiteboard tile next to a note.' },
  folders: { alt: 'Moving notes between folders from the keyboard and by dragging.' },
  markdown: { alt: 'Writing Markdown with live preview and switching to read mode.' },
  // stills
  'shot-dark': { alt: 'Velocity in dark mode.' },
  'shot-light': { alt: 'Velocity in light mode.' },
  'shot-themes': { alt: 'Velocity in a Gruvbox theme.' },
  'shot-shortcuts': { alt: 'The keyboard shortcuts sheet listing every command.' },
  'shot-palette': { alt: 'The command palette listing commands.' },
  'shot-sliding': { alt: 'Sliding tiling mode with four columns.' },
  'shot-whiteboard': { alt: 'A whiteboard tile beside two notes in dark mode.' },
  'shot-phone': { alt: 'Velocity on a phone, showing a note in the editor.' },
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const saveData = () => !!(navigator.connection && navigator.connection.saveData)

const isStill = (name) => name.startsWith('shot-')
const stemOf = (name) => (isStill(name) ? name : `${name}-poster`)

function buildImage(name, eager) {
  const img = new Image()
  const stem = stemOf(name)
  img.alt = MEDIA[name]?.alt ?? ''
  img.decoding = 'async'
  img.loading = eager ? 'eager' : 'lazy'
  if (eager) img.fetchPriority = 'high'
  img.src = `${MEDIA_BASE}${stem}.webp`
  return img
}

function buildVideo(name, img) {
  const v = document.createElement('video')
  v.muted = true
  v.defaultMuted = true
  v.loop = true
  v.autoplay = true
  v.playsInline = true
  v.preload = 'metadata'
  v.setAttribute('muted', '')
  v.setAttribute('playsinline', '')
  v.setAttribute('aria-hidden', 'true')
  v.tabIndex = -1
  v.disablePictureInPicture = true
  v.poster = img.currentSrc || img.src
  const sources = [
    ['webm', 'video/webm'],
    ['mp4', 'video/mp4'],
  ]
  let failed = 0
  for (const [ext, type] of sources) {
    const s = document.createElement('source')
    s.src = `${MEDIA_BASE}${name}.${ext}`
    s.type = type
    s.addEventListener('error', () => {
      failed += 1
      if (failed === sources.length) v.remove() // no clip yet: the poster stays
    })
    v.append(s)
  }
  v.addEventListener('playing', () => (v.dataset.live = 'true'))
  return v
}

const boxes = new Set()

function paneActive(box) {
  const pane = box.closest('[data-pane]')
  return !pane || pane.dataset.active === 'true'
}

function sync(box) {
  const want = box._inView && paneActive(box) && !document.hidden
  if (want) {
    if (!box._video && box._clip && !box._noVideo) {
      box._video = buildVideo(box.dataset.media, box._img)
      box.append(box._video)
    }
    box._video?.play()?.catch(() => {})
  } else if (box._video) {
    box._video.pause()
  }
}

/** Re-evaluate which videos should run (called when scrollytelling swaps panes). */
export function refreshMedia() {
  boxes.forEach(sync)
}

export function initMedia() {
  const noVideo = reduceMotion() || saveData()
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        e.target._inView = e.isIntersecting
        sync(e.target)
      }
    },
    { rootMargin: '160px 0px' },
  )
  document.querySelectorAll('[data-media]').forEach((box) => {
    const name = box.dataset.media
    const clip = !isStill(name)
    const img = buildImage(name, box.dataset.priority === 'high')
    box.prepend(img)
    box._img = img
    box._clip = clip
    box._noVideo = noVideo
    box.dataset.kind = clip ? 'clip' : 'still'
    boxes.add(box)
    if (clip && !noVideo) io.observe(box)
  })
  document.addEventListener('visibilitychange', refreshMedia)
}
