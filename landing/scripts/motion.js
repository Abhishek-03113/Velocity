/** Page-level motion and chrome: word reveal, scroll reveals, hero parallax, counters, nav, theme toggle. */

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Run `fn(visible)` whenever the element enters or leaves the viewport. */
export function whenVisible(el, fn, margin = '80px') {
  if (!('IntersectionObserver' in window)) return fn(true)
  new IntersectionObserver((es) => fn(es[es.length - 1].isIntersecting), { rootMargin: margin }).observe(el)
}

/* ---------- staggered word reveal ---------- */
export function splitWords(el) {
  const label = el.textContent.replace(/\s+/g, ' ').trim()
  let i = 0
  let gi = 0
  const walk = (node, grad) => {
    const frag = document.createDocumentFragment()
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return
          if (/^\s+$/.test(part)) return frag.append(' ')
          const w = document.createElement('span')
          w.className = grad ? 'w w--grad' : 'w'
          const inner = document.createElement('span')
          inner.style.setProperty('--i', String(i++))
          if (grad) inner.style.setProperty('--gi', String(gi++))
          inner.textContent = part
          w.append(inner)
          frag.append(w)
        })
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        frag.append(walk(child, grad || child.classList.contains('grad')))
      }
    })
    return frag
  }
  const out = walk(el, false)
  el.textContent = ''
  el.append(out)
  el.setAttribute('aria-label', label)
  el.querySelectorAll('.w').forEach((w) => w.setAttribute('aria-hidden', 'true'))
}

/* ---------- scroll reveals ---------- */
export function initReveal() {
  const items = document.querySelectorAll('[data-reveal]')
  if (!('IntersectionObserver' in window) || reduceMotion()) {
    items.forEach((el) => el.classList.add('in'))
    return
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in')
          io.unobserve(e.target)
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
  )
  items.forEach((el) => io.observe(el))
}

/* ---------- hero: tilt flattens as you scroll ---------- */
export function initParallax() {
  const stage = document.getElementById('hero-stage')
  if (!stage) return
  if (reduceMotion()) {
    stage.style.setProperty('--p', '1')
    return
  }
  let ticking = false
  const update = () => {
    ticking = false
    const vh = innerHeight
    const top = stage.getBoundingClientRect().top
    const p = Math.min(1, Math.max(0, 1 - (top - vh * 0.08) / (vh * 0.62)))
    stage.style.setProperty('--p', p.toFixed(3))
  }
  const onScroll = () => {
    if (!ticking) {
      ticking = true
      requestAnimationFrame(update)
    }
  }
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', onScroll, { passive: true })
  update()
}

/* ---------- count-up numerals ---------- */
export function initCounters() {
  const els = document.querySelectorAll('[data-count]')
  els.forEach((el) => {
    const prefix = el.dataset.prefix ?? ''
    el.textContent = prefix + el.dataset.count
  })
  if (reduceMotion() || !('IntersectionObserver' in window)) return
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        io.unobserve(e.target)
        const el = e.target
        const end = Number(el.dataset.count)
        const prefix = el.dataset.prefix ?? ''
        const t0 = performance.now()
        const dur = 1400
        const tick = (t) => {
          const k = Math.min(1, (t - t0) / dur)
          const eased = 1 - Math.pow(2, -10 * k)
          el.textContent = prefix + Math.round(end * eased)
          if (k < 1) requestAnimationFrame(tick)
        }
        el.textContent = prefix + '0'
        requestAnimationFrame(tick)
      }
    },
    { threshold: 0.6 },
  )
  els.forEach((el) => io.observe(el))
}

/* ---------- nav: scrolled hairline, mobile sheet, section highlight ---------- */
export function initNav() {
  const nav = document.getElementById('nav')
  const sheet = document.getElementById('nav-sheet')
  const btn = document.getElementById('menu-btn')
  const onScroll = () => (nav.dataset.scrolled = String(scrollY > 8))
  addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  const setOpen = (open) => {
    sheet.dataset.open = String(open)
    btn.setAttribute('aria-expanded', String(open))
  }
  btn.addEventListener('click', () => setOpen(sheet.dataset.open !== 'true'))
  sheet.addEventListener('click', (e) => e.target.closest('a') && setOpen(false))
  addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false))
  matchMedia('(min-width: 860px)').addEventListener('change', () => setOpen(false))

  const links = [...document.querySelectorAll('.nav__links a')]
  const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]))
  if (!('IntersectionObserver' in window)) return
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const a = map.get(e.target.id)
        if (!a) continue
        if (e.isIntersecting) a.setAttribute('aria-current', 'true')
        else a.removeAttribute('aria-current')
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  )
  map.forEach((_, id) => {
    const s = document.getElementById(id)
    if (s) io.observe(s)
  })
}

/* ---------- appearance toggle ---------- */
export function initThemeToggle() {
  const root = document.documentElement
  const resolved = () => root.dataset.theme || 'light'
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = resolved() === 'light' ? 'dark' : 'light'
    root.dataset.theme = next
    const meta = document.querySelector('meta[name=theme-color]')
    if (meta) meta.content = next === 'dark' ? '#1d2021' : '#f9f5d7'
    try {
      localStorage.setItem('velocity.landing.theme', next)
    } catch {
      /* private mode: the choice just lasts for this visit */
    }
  })
}

/* ---------- footer year ---------- */
export function initCredit() {
  const y = document.getElementById('credit-year')
  if (y) y.textContent = String(new Date().getFullYear())
}

/* ---------- save-state pill (Edited / Saving… / Offline) ---------- */
export function initStatePill() {
  const pill = document.getElementById('statepill')
  if (!pill) return
  const text = document.getElementById('statepill-text')
  const seq = [
    ['edited', 'Edited', 2200],
    ['saving', 'Saving…', 1100],
    ['edited', 'Edited', 2200],
    ['offline', 'Offline', 2600],
    ['saving', 'Saving…', 1100],
  ]
  const set = (i) => {
    const [state, label] = seq[i]
    pill.dataset.state = state
    text.textContent = label
  }
  set(0)
  if (reduceMotion()) return
  let i = 0
  let timer = 0
  const step = () => {
    i = (i + 1) % seq.length
    set(i)
    timer = setTimeout(step, seq[i][2])
  }
  whenVisible(pill, (v) => {
    clearTimeout(timer)
    if (v) timer = setTimeout(step, seq[i][2])
  })
}
