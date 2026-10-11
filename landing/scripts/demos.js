/** Small self-running demos: typing search, scrollytelling, theme picker. */

import { reduceMotion, whenVisible } from './motion.js'
import { refreshMedia } from './media.js'
import { FAMILIES, PALETTES, VARIANT_NAMES } from './themes-data.js'

/* ---------- instant search card ---------- */
const NOTES = [
  { t: 'Q4 Product Roadmap', b: 'Our focus this quarter is reliability and delight.' },
  { t: 'Travel: Kyoto', b: 'Day 1, Fushimi Inari at sunrise, then Nishiki market.' },
  { t: 'Launch plan', b: 'Ship on Tuesday, then write the roadmap recap.' },
  { t: 'Design review', b: 'Attendees: Ana, Raj, Mei. Notes on latency and the roadmap.' },
  { t: 'Reading list', b: 'The Design of Everyday Things. Designing Data-Intensive Applications.' },
  { t: 'Ideas', b: 'A keyboard that types faster than I think.' },
  { t: 'Standup', b: 'Blocked on nothing. Keyboard shortcuts for the sliding mode.' },
]
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const mark = (s, q) => {
  if (!q) return esc(s)
  const i = s.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return esc(s)
  return `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`
}

export function initSearchDemo() {
  const qEl = document.getElementById('search-q')
  const list = document.getElementById('search-hits')
  if (!qEl || !list) return
  const draw = (q) => {
    qEl.textContent = q
    const hits = q ? NOTES.filter((n) => (n.t + ' ' + n.b).toLowerCase().includes(q.toLowerCase())).slice(0, 3) : []
    list.innerHTML = hits
      .map((n, i) => `<li style="--i:${i}"><b>${mark(n.t, q)}</b><span>${mark(n.b, q)}</span></li>`)
      .join('')
  }
  const queries = ['road', 'kyoto', 'design', 'keyboard']
  if (reduceMotion()) return draw(queries[0])
  let qi = 0
  let ci = queries[0].length
  let dir = -1
  let timer = 0
  const tick = () => {
    const q = queries[qi]
    ci += dir
    draw(q.slice(0, ci))
    let delay = dir > 0 ? 120 : 45
    if (dir > 0 && ci === q.length) {
      dir = -1
      delay = 1700
    } else if (dir < 0 && ci === 0) {
      dir = 1
      qi = (qi + 1) % queries.length
      delay = 350
    }
    timer = setTimeout(tick, delay)
  }
  draw(queries[0])
  whenVisible(qEl, (v) => {
    clearTimeout(timer)
    if (v) timer = setTimeout(tick, 300)
  })
}

/* ---------- scrollytelling ---------- */
export function initScrolly() {
  const root = document.getElementById('scrolly')
  if (!root) return
  const steps = [...root.querySelectorAll('.step')]
  const panes = new Map([...root.querySelectorAll('[data-pane]')].map((p) => [p.dataset.pane, p]))
  const dots = new Map([...root.querySelectorAll('[data-dot]')].map((d) => [d.dataset.dot, d]))
  const title = document.getElementById('scrolly-title')
  const titles = { markdown: 'Writing', whiteboard: 'Whiteboard', folders: 'Folders' }
  const activate = (key) => {
    steps.forEach((s) => (s.dataset.active = String(s.dataset.step === key)))
    panes.forEach((p, k) => (p.dataset.active = String(k === key)))
    dots.forEach((d, k) => (d.dataset.active = String(k === key)))
    if (title) title.textContent = titles[key] ?? ''
    refreshMedia()
  }
  activate(steps[0].dataset.step)
  if (!('IntersectionObserver' in window)) return
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) activate(e.target.dataset.step)
    },
    { rootMargin: '-42% 0px -48% 0px' },
  )
  steps.forEach((s) => io.observe(s))
}

/* ---------- theme picker ---------- */
const ACCENTS = ['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green']

export function initThemer() {
  const root = document.getElementById('themer')
  if (!root) return
  const mock = document.getElementById('mockwin')
  const famEl = document.getElementById('th-families')
  const varEl = document.getElementById('th-variants')
  const appEl = document.getElementById('th-appearance')
  const accEl = document.getElementById('th-accents')
  const titleEl = document.getElementById('mock-title')

  const state = { family: 'gruvbox', appearance: 'dark', variants: { 'gruvbox/dark': 'hard' }, accent: 'theme' }
  const fam = () => FAMILIES.find((f) => f.id === state.family)
  const variantsFor = () => fam().variants?.[state.appearance] ?? null
  const variant = () => {
    const vs = variantsFor()
    if (!vs) return ''
    const saved = state.variants[`${state.family}/${state.appearance}`]
    return vs.includes(saved) ? saved : fam().defaults[state.appearance]
  }
  const palette = (f = state.family, a = state.appearance, v = variant()) => PALETTES[`${f}/${a}/${v}`]

  const radio = (container, onPick) => {
    container.addEventListener('click', (e) => {
      const b = e.target.closest('[role=radio]')
      if (b) onPick(b.dataset.v)
    })
    container.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
      const items = [...container.querySelectorAll('[role=radio]')]
      const i = items.indexOf(document.activeElement)
      if (i < 0) return
      e.preventDefault()
      const j = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
      items[j].focus()
      items[j].click()
    })
  }
  const setChecked = (container, value) =>
    container.querySelectorAll('[role=radio]').forEach((b) => {
      const on = b.dataset.v === value
      b.setAttribute('aria-checked', String(on))
      b.tabIndex = on ? 0 : -1
    })

  /* family chips */
  famEl.replaceChildren(
    ...FAMILIES.map((f) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'chip'
      b.setAttribute('role', 'radio')
      b.dataset.v = f.id
      b.innerHTML = `<span class="chip__sw"><i></i><i></i><i></i></span>${f.name}`
      return b
    }),
  )
  const paintSwatches = () =>
    famEl.querySelectorAll('.chip').forEach((b) => {
      const f = FAMILIES.find((x) => x.id === b.dataset.v)
      const v = f.variants ? f.defaults[state.appearance] : ''
      const p = PALETTES[`${f.id}/${state.appearance}/${v}`]
      const sw = b.querySelectorAll('i')
      sw[0].style.background = p.bg
      sw[1].style.background = p.accent
      sw[2].style.background = p.fg
    })

  const drawVariants = () => {
    const vs = variantsFor()
    varEl.hidden = !vs
    if (!vs) return varEl.replaceChildren()
    varEl.setAttribute('aria-label', fam().variantLabel ?? 'Variant')
    varEl.replaceChildren(
      ...vs.map((v) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'chip'
        b.setAttribute('role', 'radio')
        b.dataset.v = v
        b.textContent = VARIANT_NAMES[v]
        return b
      }),
    )
    setChecked(varEl, variant())
  }

  const drawAccents = () => {
    const p = palette()
    accEl.replaceChildren()
    const label = document.createElement('span')
    label.className = 'accents__label'
    label.textContent = 'Accent'
    accEl.append(label)
    ;['theme', ...ACCENTS].forEach((a) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.dataset.v = a
      b.title = a === 'theme' ? 'Theme default' : a[0].toUpperCase() + a.slice(1)
      b.setAttribute('aria-label', b.title)
      b.style.setProperty('--c', a === 'theme' ? p.accent : p[a])
      if (a === 'theme') b.className = 'is-theme'
      accEl.append(b)
    })
    setChecked(accEl, state.accent)
  }

  const apply = () => {
    const p = palette()
    const set = (k, v) => mock.style.setProperty(k, v)
    set('--m-bg', p.bg)
    set('--m-side', p.side)
    set('--m-fg', p.fg)
    set('--m-fg2', p.fg2)
    set('--m-sep', p.sep)
    set('--m-accent', state.accent === 'theme' ? p.accent : p[state.accent])
    for (const k of ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']) set(`--m-${k}`, p[k])
    for (const k of ['kw', 'fn', 'str', 'num', 'com']) set(`--m-${k}`, p[k])
    const v = variant()
    titleEl.textContent = `${fam().name}${v ? ' ' + VARIANT_NAMES[v] : ''} · ${state.appearance === 'dark' ? 'Dark' : 'Light'}`
    setChecked(famEl, state.family)
    setChecked(appEl, state.appearance)
    paintSwatches()
    drawVariants()
    drawAccents()
  }

  radio(famEl, (v) => {
    state.family = v
    state.accent = 'theme'
    apply()
  })
  radio(varEl, (v) => {
    state.variants[`${state.family}/${state.appearance}`] = v
    apply()
  })
  radio(appEl, (v) => {
    state.appearance = v
    apply()
  })
  radio(accEl, (v) => {
    state.accent = v
    apply()
  })
  apply()
}
