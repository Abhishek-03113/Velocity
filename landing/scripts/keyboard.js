/**
 * Interactive keyboard: lights up as you press real keys, names the Velocity command the
 * combo triggers, and drives a mini workspace. Shortcuts mirror client/src/lib/commands.ts.
 *
 * Safety: the page only listens while this section is on screen, ignores form fields and
 * AltGr, and only calls preventDefault() for Ctrl+Alt combos (never for browser-reserved
 * Mod+key combos such as Mod+N, Mod+W, Mod+T).
 */

import { dwindleRects, tileEl } from './tiling.js'
import { reduceMotion, whenVisible } from './motion.js'

const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

/* ---------- key layout (60 columns per row, 4 columns = 1 key unit) ---------- */
const letters = (s) => [...s].map((c) => [`Key${c}`, c, 4])
const ROWS = [
  [['Backquote', '`', 4], ...[...'1234567890'].map((d) => [`Digit${d}`, d, 4]), ['Minus', '-', 4], ['Equal', '=', 4], ['Backspace', '⌫', 8]],
  [['Tab', 'tab', 6], ...letters('QWERTYUIOP'), ['BracketLeft', '[', 4], ['BracketRight', ']', 4], ['Backslash', '\\', 6]],
  [['CapsLock', 'caps', 7], ...letters('ASDFGHJKL'), ['Semicolon', ';', 4], ['Quote', "'", 4], ['Enter', '↩', 9]],
  [['ShiftLeft', '⇧', 9, 'shift'], ...letters('ZXCVBNM'), ['Comma', ',', 4], ['Period', '.', 4], ['Slash', '/', 4], ['ShiftRight', '⇧', 11, 'shift']],
  [
    ['ControlLeft', '⌃', 5, 'ctrl'],
    ['AltLeft', '⌥', 5, 'alt'],
    ['MetaLeft', IS_MAC ? '⌘' : '⊞', 5, IS_MAC ? 'cmd' : 'win'],
    ['Space', '', 20],
    ['AltRight', '⌥', 5, 'alt'],
    ['ArrowLeft', '←', 5],
    ['ArrowUp', '↑', 5],
    ['ArrowDown', '↓', 5],
    ['ArrowRight', '→', 5],
  ],
]
const CAP_ALIAS = { ControlRight: 'ControlLeft', MetaRight: 'MetaLeft', OSLeft: 'MetaLeft', OSRight: 'MetaLeft' }
const MOD_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'])

/* ---------- command table (subset of lib/commands.ts, same keys) ---------- */
const ARROWS = [
  ['ArrowLeft', 'KeyH', 'left', 'left'],
  ['ArrowDown', 'KeyJ', 'down', 'down'],
  ['ArrowUp', 'KeyK', 'up', 'up'],
  ['ArrowRight', 'KeyL', 'right', 'right'],
]
const CMDS = [
  { keys: ['Mod+Shift+KeyP', 'F1'], id: 'palette', name: 'Command palette', desc: 'Run any command by typing a few letters.' },
  { keys: ['Mod+KeyP', 'Mod+Shift+KeyF'], id: 'quick', name: 'Quick open', desc: 'Full-text search across every note, with highlighted matches.' },
  { keys: ['Mod+KeyF'], id: 'find', name: 'Find in note', desc: 'Search inside the note you are writing.' },
  { keys: ['Ctrl+Alt+KeyN', 'Mod+KeyN'], id: 'new', name: 'New note', desc: 'A fresh note, ready to type. Ctrl+Alt+N always works in a browser.' },
  { keys: ['Ctrl+Alt+Shift+KeyN'], id: 'newTile', name: 'New note in a new tile', desc: 'Start writing next to what you are reading.' },
  { keys: ['Ctrl+Alt+KeyW', 'Mod+KeyW'], id: 'closeTab', name: 'Close note tab', desc: 'Closes the tab only; the note stays in your library.' },
  { keys: ['Ctrl+Alt+KeyM'], id: 'move', name: 'Move note to folder', desc: 'Pick a folder from the palette, or create one on the spot.' },
  { keys: ['F2'], id: 'rename', name: 'Rename note', desc: 'Rename inline, in place.' },
  { keys: ['Mod+KeyS'], id: 'save', name: 'Save now', desc: 'Velocity auto-saves. This just flushes it, right now.' },
  { keys: ['Mod+Shift+KeyE'], id: 'export', name: 'Export as Markdown', desc: 'Plain .md, yours to keep.' },
  { keys: ['Ctrl+Alt+Backslash'], id: 'splitRight', name: 'Split tile right', desc: 'Open another tile to the right of this one.' },
  { keys: ['Ctrl+Alt+Minus'], id: 'splitDown', name: 'Split tile down', desc: 'Open another tile below this one.' },
  { keys: ['Mod+Backslash'], id: 'split', name: 'Split tile', desc: 'Velocity picks the better side for you.' },
  { keys: ['Ctrl+Alt+KeyQ'], id: 'closeTile', name: 'Close tile', desc: 'The note stays; only the tile goes away.' },
  { keys: ['Ctrl+Alt+Enter'], id: 'zoom', name: 'Zoom tile', desc: 'Monocle the focused tile. Press again to return.' },
  { keys: ['Ctrl+Alt+Equal'], id: 'equalize', name: 'Equalise tiles', desc: 'Give every tile the same share of the screen.' },
  { keys: ['Ctrl+Alt+KeyR'], id: 'rotate', name: 'Rotate split', desc: 'Flip a split between side by side and stacked.' },
  { keys: ['Ctrl+Alt+KeyT'], id: 'mode', name: 'Toggle tiling mode', desc: 'Switch between dwindle and sliding columns.' },
  { keys: ['Ctrl+Alt+KeyC'], id: 'width', name: 'Cycle column width', desc: 'In sliding mode: ½, ⅔, full, ⅓.' },
  { keys: ['Ctrl+Alt+KeyS', 'Mod+Digit1'], id: 'sidebar', name: 'Toggle sidebar', desc: 'More room for the words.' },
  { keys: ['Ctrl+Alt+Shift+KeyS'], id: 'folders', name: 'Toggle folders column', desc: 'Hide or show the folders.' },
  { keys: ['Ctrl+Alt+BracketRight'], id: 'nextTab', name: 'Next tab', desc: 'Cycle through open notes.' },
  { keys: ['Ctrl+Alt+BracketLeft'], id: 'prevTab', name: 'Previous tab', desc: 'Cycle back through open notes.' },
  { keys: ['Ctrl+Alt+Digit0'], id: 'list', name: 'Focus notes list', desc: 'Jump to the library and browse with the arrow keys.' },
  { keys: ['Mod+KeyE'], id: 'read', name: 'Read mode', desc: 'Typeset Markdown, one key away.' },
  { keys: ['Mod+Shift+KeyD'], id: 'board', name: 'Whiteboard tile', desc: 'Open this note’s Excalidraw board as a tile.' },
  { keys: ['Mod+KeyB'], id: 'bold', name: 'Bold', desc: 'Wraps the selection in **bold**.' },
  { keys: ['Mod+KeyI'], id: 'italic', name: 'Italic', desc: 'Wraps the selection in *italics*.' },
  { keys: ['Mod+KeyK'], id: 'link', name: 'Insert link', desc: 'Turns the selection into a Markdown link.' },
  { keys: ['Mod+Shift+KeyX'], id: 'strike', name: 'Strikethrough', desc: 'Cross it out.' },
  { keys: ['Mod+Shift+KeyM'], id: 'code', name: 'Inline code', desc: 'Backticks around the selection.' },
  { keys: ['Mod+Shift+KeyH'], id: 'heading', name: 'Cycle heading', desc: 'Body, H1, H2, H3, and around again.' },
  { keys: ['Mod+Shift+KeyL'], id: 'checklist', name: 'Toggle checklist', desc: 'Turn lines into round checkboxes.' },
  { keys: ['Mod+Equal'], id: 'bigger', name: 'Bigger text', desc: 'Mod+- shrinks, Mod+0 resets.' },
  { keys: ['Mod+Comma'], id: 'settings', name: 'Settings', desc: 'Themes, accents, type and tiling mode.' },
  { keys: ['Mod+Slash'], id: 'shortcuts', name: 'Keyboard shortcuts', desc: 'The full cheat sheet, always up to date.' },
  ...ARROWS.flatMap(([arrow, vim, dir]) => [
    { keys: [`Ctrl+Alt+${arrow}`, `Ctrl+Alt+${vim}`], id: `focus-${dir}`, name: `Focus tile ${dir}`, desc: 'Move focus without touching the mouse. H J K L work too.' },
    { keys: [`Ctrl+Alt+Shift+${arrow}`, `Ctrl+Alt+Shift+${vim}`], id: `swap-${dir}`, name: `Move note ${dir}`, desc: 'Carry the note into the neighbouring tile.' },
  ]),
  ...Array.from({ length: 9 }, (_, i) => ({ keys: [`Ctrl+Alt+Digit${i + 1}`], id: `tab${i + 1}`, name: `Go to tab ${i + 1}`, desc: 'The browser keeps Mod+1–9. Ctrl+Alt+1–9 is yours.' })),
]

function parse(spec) {
  const parts = spec.split('+')
  const code = parts.pop()
  const m = new Set(parts)
  return { code, mod: m.has('Mod'), ctrl: m.has('Ctrl'), alt: m.has('Alt'), shift: m.has('Shift') }
}
const TABLE = CMDS.flatMap((c) => c.keys.map((k) => ({ cmd: c, spec: k, ...parse(k) })))

function matches(t, e) {
  if (e.code !== t.code || e.shiftKey !== t.shift || e.altKey !== t.alt) return false
  if (t.mod) return IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (t.ctrl) return e.ctrlKey && !e.metaKey
  return !e.ctrlKey && !e.metaKey
}

const KEY_LABEL = {
  Backslash: '\\', Minus: '-', Equal: '=', Enter: '↩', Comma: ',', Slash: '/', BracketLeft: '[', BracketRight: ']', Backspace: '⌫',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', F1: 'F1', F2: 'F2',
}
function keyLabel(code) {
  if (KEY_LABEL[code]) return KEY_LABEL[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}
function comboCaps(t) {
  const out = []
  if (t.mod) out.push(IS_MAC ? '⌘' : 'Ctrl')
  if (t.ctrl) out.push(IS_MAC ? '⌃' : 'Ctrl')
  if (t.alt) out.push(IS_MAC ? '⌥' : 'Alt')
  if (t.shift) out.push(IS_MAC ? '⇧' : 'Shift')
  out.push(keyLabel(t.code))
  return out
}
function comboCodes(t) {
  const out = []
  if (t.mod) out.push(IS_MAC ? 'MetaLeft' : 'ControlLeft')
  if (t.ctrl) out.push('ControlLeft')
  if (t.alt) out.push('AltLeft')
  if (t.shift) out.push('ShiftLeft')
  out.push(t.code)
  return out
}

/* ---------- mini workspace ---------- */
function createMini() {
  const mini = document.getElementById('mini')
  const area = document.getElementById('mini-tiles')
  const palette = document.getElementById('mini-palette')
  const tag = document.createElement('div')
  tag.className = 'mini__tag'
  const toast = document.createElement('div')
  toast.className = 'mini__toast'
  mini.append(tag, toast)

  const state = { tiles: [0, 1], focus: 1, zoom: false, mode: 'dwindle', width: 50, next: 2 }
  const els = new Map()
  let palTimer = 0
  let toastTimer = 0
  const MAX = 5

  const say = (msg) => {
    toast.textContent = msg
    toast.dataset.open = 'true'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.dataset.open = 'false'), 1700)
  }
  const openPalette = (label, items) => {
    palette.querySelector('em').textContent = label
    const lis = palette.querySelectorAll('li')
    items.forEach((t, i) => (lis[i].textContent = t))
    palette.dataset.open = 'true'
    clearTimeout(palTimer)
    palTimer = setTimeout(() => (palette.dataset.open = 'false'), 2100)
  }

  const render = () => {
    const n = state.tiles.length
    // Create or remove elements
    state.tiles.forEach((id) => {
      if (!els.has(id)) {
        const t = tileEl(id, 'mtile')
        t.firstElementChild.classList.replace('dtile__in', 'mtile__in')
        t.querySelector('.dtile__t').className = 'mtile__t'
        t.querySelectorAll('.dtile__l').forEach((l) => (l.className = 'mtile__l'))
        area.append(t)
        els.set(id, t)
      }
    })
    els.forEach((el, id) => {
      if (!state.tiles.includes(id)) {
        el.style.opacity = '0'
        setTimeout(() => el.remove(), 350)
        els.delete(id)
      }
    })
    const rects = dwindleRects(n)
    state.tiles.forEach((id, i) => {
      const el = els.get(id)
      let r
      if (state.zoom) {
        r = i === state.focus ? { x: 0, y: 0, w: 100, h: 100 } : { x: 50, y: 50, w: 0, h: 0 }
      } else if (state.mode === 'sliding') {
        const w = state.width
        const left = i * w
        const total = n * w
        const x = Math.max(0, Math.min(state.focus * w + w / 2 - 50, Math.max(0, total - 100)))
        r = { x: left - x, y: 0, w, h: 100 }
      } else {
        r = rects[i]
      }
      el.style.left = `${r.x}%`
      el.style.top = `${r.y}%`
      el.style.width = `${r.w}%`
      el.style.height = `${r.h}%`
      el.style.opacity = state.zoom && i !== state.focus ? '0' : '1'
      el.classList.toggle('is-focus', i === state.focus)
    })
    tag.textContent = `${state.mode === 'sliding' ? 'Sliding' : 'Dwindle'}${state.zoom ? ' · Zoom' : ''} · ${n} ${n === 1 ? 'tile' : 'tiles'}`
  }
  render()

  const split = () => {
    if (state.tiles.length >= MAX) return say('Plenty of tiles. Try Ctrl+Alt+Q to close one.')
    state.zoom = false
    state.tiles.splice(state.focus + 1, 0, state.next++)
    state.focus += 1
    render()
  }
  const move = (d) => {
    state.focus = Math.max(0, Math.min(state.tiles.length - 1, state.focus + d))
    render()
  }
  const dirDelta = { left: -1, up: -1, right: 1, down: 1 }
  const WIDTHS = [50, 66, 100, 33]

  const ACTIONS = {
    palette: () => openPalette('Split tile right', ['Split tile right', 'Toggle tiling mode', 'Move note to folder']),
    quick: () => openPalette('roadmap', ['Q4 Roadmap', 'Travel — Kyoto', 'Launch plan']),
    shortcuts: () => openPalette('Keyboard shortcuts', ['Split tile right  ⌃⌥\\', 'Zoom tile  ⌃⌥↩', 'Read mode  ⌘E']),
    new: () => {
      split()
      say('New note')
    },
    newTile: () => split(),
    split,
    splitRight: split,
    splitDown: split,
    closeTile: () => {
      if (state.tiles.length === 1) return say('That is the last tile.')
      state.zoom = false
      state.tiles.splice(state.focus, 1)
      state.focus = Math.min(state.focus, state.tiles.length - 1)
      render()
    },
    closeTab: () => ACTIONS.closeTile(),
    zoom: () => {
      state.zoom = !state.zoom
      render()
    },
    equalize: () => say('Tiles equalised'),
    rotate: () => {
      state.tiles.reverse()
      state.focus = state.tiles.length - 1 - state.focus
      render()
    },
    mode: () => {
      state.mode = state.mode === 'dwindle' ? 'sliding' : 'dwindle'
      state.zoom = false
      render()
      say(`${state.mode === 'sliding' ? 'Sliding' : 'Dwindle'} tiling`)
    },
    width: () => {
      if (state.mode !== 'sliding') return say('Switch to sliding with Ctrl+Alt+T first')
      state.width = WIDTHS[(WIDTHS.indexOf(state.width) + 1) % WIDTHS.length]
      render()
      say(`Column width ${state.width === 50 ? '½' : state.width === 66 ? '⅔' : state.width === 100 ? 'full' : '⅓'}`)
    },
    sidebar: () => (mini.dataset.sidebar = mini.dataset.sidebar === 'on' ? 'off' : 'on'),
    folders: () => (mini.dataset.sidebar = mini.dataset.sidebar === 'on' ? 'off' : 'on'),
    read: () => (mini.dataset.read = mini.dataset.read === 'on' ? 'off' : 'on'),
    move: () => say('Moved to Work'),
    save: () => say('Saved'),
    find: () => say('Find in note'),
    board: () => say('Whiteboard opened as a tile'),
    nextTab: () => move(1),
    prevTab: () => move(-1),
  }
  for (const dir of Object.keys(dirDelta)) {
    ACTIONS[`focus-${dir}`] = () => move(dirDelta[dir])
    ACTIONS[`swap-${dir}`] = () => {
      const j = state.focus + dirDelta[dir]
      if (j < 0 || j >= state.tiles.length) return
      ;[state.tiles[state.focus], state.tiles[j]] = [state.tiles[j], state.tiles[state.focus]]
      state.focus = j
      render()
    }
  }
  return { run: (id) => ACTIONS[id]?.() }
}

/* ---------- board ---------- */
export function initKeyboard() {
  const boardEl = document.getElementById('kbd-board')
  const section = document.getElementById('try')
  if (!boardEl || !section) return

  const grid = document.createElement('div')
  grid.className = 'kbd-grid'
  const capEls = new Map()
  ROWS.forEach((row) =>
    row.forEach(([code, label, w, word]) => {
      const k = document.createElement('div')
      k.className = word && label.length === 1 && code !== 'Space' ? 'key key--mod' : 'key'
      k.style.setProperty('--w', String(w))
      k.dataset.code = code
      if (word) k.innerHTML = `<span>${label}</span><small>${word}</small>`
      else k.textContent = label
      if (code === 'ControlLeft' || code === 'AltLeft' || code === 'ShiftLeft' || code === 'MetaLeft') k.classList.add('key--mod')
      grid.append(k)
      capEls.set(code, k)
    }),
  )
  boardEl.append(grid)

  const mini = createMini()
  const comboEl = document.getElementById('kb-combo')
  const nameEl = document.getElementById('kb-name')
  const descEl = document.getElementById('kb-desc')
  const chipsEl = document.getElementById('kb-chips')

  const down = new Set()
  const paint = () => {
    const lit = new Set([...down].map((c) => CAP_ALIAS[c] ?? c))
    capEls.forEach((el, code) => el.classList.toggle('is-down', lit.has(code)))
  }
  const hit = (codes) => {
    codes.forEach((c) => {
      const el = capEls.get(CAP_ALIAS[c] ?? c)
      if (!el) return
      el.classList.remove('is-hit')
      void el.offsetWidth
      el.classList.add('is-hit')
      setTimeout(() => el.classList.remove('is-hit'), 850)
    })
  }

  const show = (caps, name, desc, nameHtml) => {
    comboEl.replaceChildren(
      ...caps.map((c) => Object.assign(document.createElement('span'), { className: 'keycap', textContent: c })),
    )
    nameEl.replaceChildren()
    if (nameHtml) nameEl.innerHTML = nameHtml
    else nameEl.textContent = name
    descEl.textContent = desc
  }

  const trigger = (t) => {
    show(comboCaps(t), t.cmd.name, t.cmd.desc)
    hit(comboCodes(t))
    mini.run(t.cmd.id)
  }

  /* real keyboard */
  let active = false
  let userTouched = false
  whenVisible(section, (v) => (active = v), '-10% 0px')

  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
  addEventListener('keydown', (e) => {
    if (!active || typing(e.target)) return
    if (e.getModifierState && e.getModifierState('AltGraph')) return
    down.add(e.code)
    paint()
    if (MOD_CODES.has(e.code)) return
    const t = TABLE.find((x) => matches(x, e))
    if (t) {
      userTouched = true
      if (t.ctrl && t.alt) e.preventDefault() // only the Ctrl+Alt layer; never browser-reserved combos
      trigger(t)
    } else if (e.ctrlKey || e.metaKey || e.altKey) {
      userTouched = true
      show(
        [...(e.metaKey ? [IS_MAC ? '⌘' : 'Win'] : []), ...(e.ctrlKey ? [IS_MAC ? '⌃' : 'Ctrl'] : []), ...(e.altKey ? [IS_MAC ? '⌥' : 'Alt'] : []), ...(e.shiftKey ? [IS_MAC ? '⇧' : 'Shift'] : []), keyLabel(e.code)],
        '',
        'Velocity has a command for nearly everything. Try Ctrl+Alt+\\ to split a tile.',
        'Not bound. Yet.',
      )
    }
  })
  addEventListener('keyup', (e) => {
    down.delete(e.code)
    // macOS never sends keyup for keys released while Meta is held
    if (e.code.startsWith('Meta')) down.clear()
    paint()
  })
  addEventListener('blur', () => {
    down.clear()
    paint()
  })

  /* tap-to-try chips (touch and mouse) */
  const TRY = [
    ['Palette', 'Mod+Shift+KeyP'],
    ['Split right', 'Ctrl+Alt+Backslash'],
    ['Focus left', 'Ctrl+Alt+ArrowLeft'],
    ['Zoom', 'Ctrl+Alt+Enter'],
    ['Tiling mode', 'Ctrl+Alt+KeyT'],
    ['Read mode', 'Mod+KeyE'],
    ['Move to folder', 'Ctrl+Alt+KeyM'],
  ]
  const simulate = (spec) => {
    const t = TABLE.find((x) => x.spec === spec)
    if (!t) return
    const codes = comboCodes(t)
    codes.forEach((c) => down.add(c))
    paint()
    trigger(t)
    setTimeout(() => {
      codes.forEach((c) => down.delete(c))
      paint()
    }, 750)
  }
  TRY.forEach(([label, spec]) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'chip'
    b.textContent = label
    b.addEventListener('click', () => {
      userTouched = true
      simulate(spec)
    })
    chipsEl.append(b)
  })

  /* idle demo: play through shortcuts until the visitor takes over */
  if (!reduceMotion()) {
    const demo = ['Ctrl+Alt+Backslash', 'Ctrl+Alt+Backslash', 'Ctrl+Alt+ArrowLeft', 'Mod+Shift+KeyP', 'Ctrl+Alt+Enter', 'Ctrl+Alt+Enter', 'Ctrl+Alt+KeyT', 'Ctrl+Alt+KeyT', 'Mod+KeyE', 'Mod+KeyE', 'Ctrl+Alt+KeyQ']
    let i = 0
    setInterval(() => {
      if (userTouched || !active || document.hidden) return
      simulate(demo[i++ % demo.length])
    }, 2300)
  }
}
