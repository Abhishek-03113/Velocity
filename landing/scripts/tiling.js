/** Animated tiling diagrams (dwindle + sliding) and the shared layout maths. */

import { reduceMotion, whenVisible } from './motion.js'

const NAMES = ['Roadmap', 'Kyoto', 'Ideas', 'Standup', 'Scratchpad', 'Reading']
const COLORS = ['blue', 'orange', 'green', 'purple', 'pink', 'teal']

/**
 * Dwindle: every new tile splits the previous one along its longer side.
 * Returns percentage rects for n tiles, in creation order (same rule as the app's engine).
 */
export function dwindleRects(n, ar = 1.6) {
  const r = [{ x: 0, y: 0, w: 100, h: 100 }]
  for (let i = 1; i < n; i += 1) {
    const p = r[i - 1]
    if (p.w * ar >= p.h) {
      const w = p.w / 2
      r[i - 1] = { ...p, w }
      r.push({ x: p.x + w, y: p.y, w, h: p.h })
    } else {
      const h = p.h / 2
      r[i - 1] = { ...p, h }
      r.push({ x: p.x, y: p.y + h, w: p.w, h })
    }
  }
  return r.slice(0, n)
}

export function tileEl(i, cls = 'dtile') {
  const el = document.createElement('div')
  el.className = cls
  const lines = '<span class="dtile__l"></span>'.repeat(4)
  el.innerHTML = `<div class="dtile__in"><div class="dtile__t"><i style="--c: var(--system-${COLORS[i % 6]})"></i>${NAMES[i % 6]}</div>${lines}</div>`
  return el
}

export function keycaps(container, keys, label) {
  container.replaceChildren()
  keys.forEach((k) => {
    const c = document.createElement('span')
    c.className = 'keycap'
    c.textContent = k
    container.append(c)
  })
  if (label) {
    const l = document.createElement('span')
    l.className = 'diagram__label'
    l.textContent = label
    container.append(l)
  }
}

/** Run steps in a loop while the element is on screen; reduced motion shows one static frame. */
function player(el, steps, apply, ms, staticIndex) {
  let i = 0
  let timer = 0
  const run = () => {
    apply(steps[i])
    i = (i + 1) % steps.length
    timer = setTimeout(run, ms)
  }
  if (reduceMotion()) {
    apply(steps[staticIndex ?? steps.length - 1])
    return
  }
  apply(steps[0])
  i = 1
  whenVisible(
    el,
    (v) => {
      clearTimeout(timer)
      if (v) timer = setTimeout(run, ms)
    },
    '0px',
  )
}

/* ---------- dwindle ---------- */
export function initDwindle() {
  const root = document.getElementById('dwindle')
  if (!root) return
  const stage = root.querySelector('.diagram__stage')
  const keys = document.getElementById('dwindle-keys')
  const tiles = NAMES.slice(0, 5).map((_, i) => {
    const t = tileEl(i)
    stage.append(t)
    return t
  })
  const steps = [
    { n: 1, f: 0, keys: [], label: 'One note, full focus' },
    { n: 2, f: 1, keys: ['⌃', '⌥', '\\'], label: 'Split right' },
    { n: 3, f: 2, keys: ['⌃', '⌥', '-'], label: 'Split down' },
    { n: 4, f: 3, keys: ['⌘', '\\'], label: 'Auto split' },
    { n: 5, f: 4, keys: ['⌘', '\\'], label: 'Auto split' },
    { n: 5, f: 1, keys: ['⌃', '⌥', '←'], label: 'Focus' },
    { n: 1, f: 0, keys: ['⌃', '⌥', 'Q'], label: 'Close tiles' },
  ]
  const apply = ({ n, f, keys: k, label }) => {
    const rects = dwindleRects(n)
    tiles.forEach((t, i) => {
      const on = i < n
      const r = on ? rects[i] : dwindleRects(i + 1)[i]
      t.style.left = `${r.x}%`
      t.style.top = `${r.y}%`
      t.style.width = `${r.w}%`
      t.style.height = `${r.h}%`
      t.dataset.on = String(on)
      t.classList.toggle('is-focus', on && i === f)
    })
    keycaps(keys, k, label)
  }
  player(root, steps, apply, 1900, 4)
}

/* ---------- sliding ---------- */
export function initSliding() {
  const root = document.getElementById('sliding')
  if (!root) return
  const strip = document.getElementById('strip')
  const mini = document.getElementById('minimap')
  const keys = document.getElementById('sliding-keys')
  const layout = [1, 1, 2, 1, 1] // tiles per column
  let n = 0
  const cols = layout.map((count) => {
    const col = document.createElement('div')
    col.className = 'scol'
    const host = count > 1 ? Object.assign(document.createElement('div'), { className: 'scol__stack' }) : col
    for (let k = 0; k < count; k += 1) {
      const t = tileEl(n++)
      host.append(t.firstElementChild)
    }
    if (host !== col) col.append(host)
    strip.append(col)
    mini.append(document.createElement('i'))
    return col
  })
  const widths = [50, 50, 50, 50, 50]
  const steps = [
    { f: 0, w: 50, keys: [], label: 'Focus stays in view' },
    { f: 1, w: 50, keys: ['⌃', '⌥', '→'], label: 'Focus next' },
    { f: 2, w: 50, keys: ['⌃', '⌥', '→'], label: 'Focus next' },
    { f: 3, w: 50, keys: ['⌃', '⌥', '→'], label: 'Focus next' },
    { f: 4, w: 50, keys: ['⌃', '⌥', '→'], label: 'Focus next' },
    { f: 4, w: 66, keys: ['⌃', '⌥', 'C'], label: 'Cycle width' },
    { f: 4, w: 100, keys: ['⌃', '⌥', 'C'], label: 'Cycle width' },
    { f: 4, w: 33, keys: ['⌃', '⌥', 'C'], label: 'Cycle width' },
    { f: 0, w: 50, keys: ['⌃', '⌥', '←'], label: 'Jump back' },
  ]
  const apply = ({ f, w, keys: k, label }) => {
    widths[4] = w
    cols.forEach((c, i) => {
      c.dataset.w = String(widths[i])
      c.classList.toggle('is-focus', i === f)
      mini.children[i].classList.toggle('on', i === f)
    })
    // Centre the focused column, clamped to the strip (same idea as the app's sliding engine).
    const left = widths.slice(0, f).reduce((a, b) => a + b, 0)
    const total = widths.reduce((a, b) => a + b, 0)
    const x = Math.max(0, Math.min(left + widths[f] / 2 - 50, total - 100))
    strip.style.transform = `translate3d(${-x}%, 0, 0)`
    keycaps(keys, k, label)
  }
  player(root, steps, apply, 1800, 2)
}
