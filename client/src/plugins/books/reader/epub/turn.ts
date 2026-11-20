/**
 * Page-turn effects for the paged EPUB layout.
 *
 * epub.js jumps to the next page instantly. To animate, the engine first takes a *ghost*: a copy of the page
 * that is on screen (the chapter document cloned into an overlay iframe with its CSS inlined, plus the highlight
 * layers), laid exactly over the live page. Then epub.js turns the page underneath, unseen, and the ghost
 * animates away to reveal it. Only transform and opacity are animated, through the Web Animations API, so the
 * work stays on the compositor.
 *
 * The cloned chapter is kept, hidden, between turns (and prepared ahead with `warmGhost` while the reader is idle):
 * a turn inside the same chapter only moves the copy to the current page, so it starts in the same frame, with the
 * book's fonts already loaded in the copy (a fresh copy would first paint in a fallback font: the glitch).
 *
 *  - slide: a push, the outgoing sheet leaves as the incoming one arrives edge to edge, 280 ms
 *  - fade:  the ghost cross-fades out, 140 ms
 *  - curl:  a page flip (`../pageFlip.ts`): the outgoing page folds from its corner along a moving fold line, its
 *           back and the fold shadows showing, over the new page. Going back, the live page unfolds over the ghost.
 *
 * Every iframe involved is pinned to `color-scheme: light` (its document's scheme). In a dark app an iframe that
 * inherits `dark` is painted on an opaque white canvas: that was the white flash during turns.
 */
import type { TurnDir } from './helpers'
import { FLIP_MS, playPageFlip, type FlipCorner, type PageFlip } from '../pageFlip'

export type TurnEffect = 'curl' | 'slide' | 'fade' | 'none'

export interface TurnEnv {
  /** Positioned, clipping element that holds both the stage and the ghost layer. Gets `perspective` for curl. */
  root: HTMLElement
  /** Full-size wrapper around the mount: the live page, animated for the incoming side. */
  stage: HTMLElement
  /** Where ghosts are added. */
  layer: HTMLElement
  /** Element epub.js renders into; its iframe is the live page. */
  mount: HTMLElement
  background: string
  backgroundImage: string | null
  /** Changes whenever the page's look changes (appearance, colours); a kept copy with another key is rebuilt. */
  key?: string
  /** Dark paper: the page flip keeps its sheen and shadows tuned to it. */
  dark?: boolean
  /** Which corner the page flip lifts (the half of the page that was tapped); bottom by default. */
  corner?: FlipCorner
}

export interface Ghost {
  el: HTMLElement
  dispose(): void
}

export const SLIDE_MS = 280
export const FADE_MS = 140
export const CURL_MS = FLIP_MS
export const TURN_EASE = 'cubic-bezier(.2,.8,.2,1)'

function paper(env: Pick<TurnEnv, 'background' | 'backgroundImage'>): string {
  return `background-color:${env.background};${env.backgroundImage ? `background-image:${env.backgroundImage};` : ''}`
}

function collectCss(doc: Document): string {
  const out: string[] = []
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out.push(rule.cssText)
    } catch {
      /* cross-origin sheet: cannot happen for book resources, skip */
    }
  }
  return out.join('\n')
}

interface Kept {
  doc: Document
  key: string | undefined
  ghost: HTMLDivElement
  clip: HTMLDivElement
  copy: HTMLIFrameElement
}

/** The kept copy per ghost layer (one per reader). */
const kept = new WeakMap<HTMLElement, Kept>()

const GHOST_CSS = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3;will-change:transform,opacity;'

function liveFrame(env: TurnEnv): { frame: HTMLIFrameElement; doc: Document } | null {
  const frame = env.mount.querySelector<HTMLIFrameElement>('iframe')
  const doc = frame?.contentDocument
  return frame && doc?.documentElement ? { frame, doc } : null
}

/** Build the hidden copy of the live chapter. */
function build(env: TurnEnv, doc: Document): Kept | null {
  const ghost = document.createElement('div')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.cssText = `${GHOST_CSS}visibility:hidden;${paper(env)}`
  const clip = document.createElement('div')
  const copy = document.createElement('iframe')
  copy.style.cssText = 'border:0;background:transparent;color-scheme:light;'
  copy.setAttribute('sandbox', 'allow-same-origin')
  copy.setAttribute('tabindex', '-1')
  clip.appendChild(copy)
  ghost.appendChild(clip)
  env.layer.appendChild(ghost)

  const d = copy.contentDocument
  if (!d) {
    ghost.remove()
    return null
  }
  d.open()
  d.write('<!doctype html><html><head></head><body></body></html>')
  d.close()
  const clone = d.importNode(doc.documentElement, true) as HTMLElement
  clone.querySelectorAll('script, link[rel~="stylesheet"], style, base').forEach((n) => n.remove())
  const style = d.createElement('style')
  style.textContent = collectCss(doc)
  let head = clone.querySelector('head')
  if (!head) {
    head = d.createElement('head')
    clone.insertBefore(head, clone.firstChild)
  }
  head.appendChild(style)
  d.replaceChild(clone, d.documentElement)
  return { doc, key: env.key, ghost, clip, copy }
}

/** The kept copy for the live chapter, (re)built when the chapter or the look changed. */
function keptFor(env: TurnEnv): Kept | null {
  const live = liveFrame(env)
  if (!live) return null
  const k = kept.get(env.layer)
  if (k && k.doc === live.doc && k.key === env.key && k.ghost.parentNode === env.layer) return k
  k?.ghost.remove()
  const next = build(env, live.doc)
  if (next) kept.set(env.layer, next)
  else kept.delete(env.layer)
  return next
}

/** Prepare the copy for the page on screen ahead of the next turn (call while idle). */
export function warmGhost(env: TurnEnv): void {
  try {
    keptFor(env)
  } catch {
    /* best effort: the turn builds it */
  }
}

/** Show the copy exactly over the live page. Null when there is nothing to copy. */
export function takeGhost(env: TurnEnv): Ghost | null {
  try {
    const k = keptFor(env)
    const live = liveFrame(env)
    if (!k || !live) return null
    const rootRect = env.root.getBoundingClientRect()
    const mountRect = env.mount.getBoundingClientRect()
    const frameRect = live.frame.getBoundingClientRect()
    k.clip.style.cssText = `position:absolute;overflow:hidden;left:${mountRect.left - rootRect.left}px;top:${mountRect.top - rootRect.top}px;width:${mountRect.width}px;height:${mountRect.height}px;`
    // color-scheme: light, as on the live frame: in a dark app an iframe whose scheme differs from its document's is
    // painted on an opaque white canvas, which flashed white through every turn effect.
    k.copy.style.cssText = `position:absolute;left:${frameRect.left - mountRect.left}px;top:${frameRect.top - mountRect.top}px;width:${frameRect.width}px;height:${frameRect.height}px;border:0;background:transparent;color-scheme:light;z-index:1;pointer-events:none;`

    // Highlights drawn over the live page come along (they change between turns, so they are copied each time).
    k.clip.querySelectorAll('svg').forEach((n) => n.remove())
    const back = env.mount.querySelector<SVGElement>('svg[data-vel-marks="back"]')?.cloneNode(true) as SVGElement | undefined
    const front = env.mount.querySelector<SVGElement>('svg[data-vel-marks="front"]')?.cloneNode(true) as SVGElement | undefined
    if (back) k.clip.insertBefore(back, k.copy)
    if (front) k.clip.appendChild(front)

    k.ghost.getAnimations().forEach((a) => a.cancel())
    k.ghost.style.cssText = `${GHOST_CSS}${paper(env)}`
    // Force layout now so the first painted frame already matches the live page.
    void k.copy.contentDocument?.documentElement.getBoundingClientRect()
    const ghost = k.ghost
    return {
      el: ghost,
      dispose: () => {
        ghost.getAnimations().forEach((a) => a.cancel())
        ghost.style.cssText = `${GHOST_CSS}visibility:hidden;${paper(env)}`
      },
    }
  } catch {
    return null
  }
}

function finish(anims: Animation[]): Promise<void> {
  return Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined)
}

/** Run one turn. Resolves when the animation is done; always leaves the DOM as it found it. */
export async function playTurn(effect: Exclude<TurnEffect, 'none'>, dir: TurnDir, ghost: Ghost, env: TurnEnv): Promise<void> {
  const { stage, root } = env
  const anims: Animation[] = []
  const extra: HTMLElement[] = []
  const w = root.clientWidth
  let flipRef: PageFlip | null = null
  const reset = () => {
    flipRef?.cancel()
    for (const a of anims) {
      try {
        a.cancel()
      } catch {
        /* already finished */
      }
    }
    for (const n of extra) n.remove()
    for (const p of ['transform-origin', 'backface-visibility', 'z-index', 'background-color', 'background-image', 'will-change']) stage.style.removeProperty(p)
    ghost.dispose()
  }
  try {
    if (effect === 'fade') {
      anims.push(ghost.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-out', fill: 'forwards' }))
      await finish(anims)
      return
    }

    if (effect === 'slide') {
      // A push: the old sheet (opaque paper) leaves as the new one arrives edge to edge, so two pages of text never
      // overlap mid-turn (the old 30% drift + cross-fade showed both at once).
      const dist = w * (dir === 'next' ? 1 : -1)
      stage.style.willChange = 'transform'
      const opts = { duration: SLIDE_MS, easing: TURN_EASE, fill: 'forwards' as const }
      anims.push(
        ghost.el.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-dist}px,0,0)` }], opts),
        stage.animate([{ transform: `translate3d(${dist}px,0,0)` }, { transform: 'translate3d(0,0,0)' }], opts),
      )
      await finish(anims)
      return
    }

    // curl: a page flip. Forward, the copy of the old page folds away over the new one; back, the live (previous)
    // page unfolds over the copy of the old one.
    const next = dir === 'next'
    const leaf = next ? ghost.el : stage
    if (!next) {
      // The live page is the one that turns: give it paper so the copy beneath does not show through it.
      stage.style.backgroundColor = env.background
      if (env.backgroundImage) stage.style.backgroundImage = env.backgroundImage
    }
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;'
    root.appendChild(host)
    extra.push(host)
    const flip = playPageFlip({
      leaf,
      host,
      width: w,
      height: root.clientHeight,
      dir,
      corner: env.corner,
      paper: { color: env.background, image: env.backgroundImage, dark: !!env.dark },
      duration: CURL_MS,
    })
    if (!next) {
      // Stack after the first fold is applied (same task, so no frame shows the new page whole).
      stage.style.zIndex = '4'
      ghost.el.style.zIndex = '2'
    }
    flipRef = flip
    await flip.done
  } finally {
    reset()
  }
}
