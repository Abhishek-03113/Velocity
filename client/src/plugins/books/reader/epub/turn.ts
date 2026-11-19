/**
 * Page-turn effects for the paged EPUB layout.
 *
 * epub.js jumps to the next page instantly. To animate, the engine first takes a *ghost*: a copy of the page
 * that is on screen (the chapter document cloned into an overlay iframe with its CSS inlined, plus the highlight
 * layers), laid exactly over the live page. Then epub.js turns the page underneath, unseen, and the ghost
 * animates away to reveal it. Only transform and opacity are animated, through the Web Animations API, so the
 * work stays on the compositor.
 *
 *  - slide: the outgoing page drifts 30% (capped) and fades while the incoming page drifts in, 220 ms
 *  - fade:  the ghost cross-fades out, 140 ms
 *  - curl:  the outgoing page swings about its left edge in 3D (perspective) with a shade on its face and a
 *           shadow cast onto the page beneath. Going back, the live page swings in over the ghost instead.
 */
import type { TurnDir } from './helpers'

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
}

export interface Ghost {
  el: HTMLElement
  dispose(): void
}

export const SLIDE_MS = 220
export const FADE_MS = 140
export const CURL_MS = 460
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

/** Copy the visible page into an overlay that sits exactly over it. Null when there is nothing to copy. */
export function takeGhost(env: TurnEnv): Ghost | null {
  const frame = env.mount.querySelector<HTMLIFrameElement>('iframe')
  const doc = frame?.contentDocument
  if (!frame || !doc?.documentElement) return null
  try {
    const rootRect = env.root.getBoundingClientRect()
    const mountRect = env.mount.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()

    const ghost = document.createElement('div')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.style.cssText = `position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3;will-change:transform,opacity;${paper(env)}`
    const clip = document.createElement('div')
    clip.style.cssText = `position:absolute;overflow:hidden;left:${mountRect.left - rootRect.left}px;top:${mountRect.top - rootRect.top}px;width:${mountRect.width}px;height:${mountRect.height}px;`
    const left = frameRect.left - mountRect.left
    const top = frameRect.top - mountRect.top
    const place = `position:absolute;left:${left}px;top:${top}px;width:${frameRect.width}px;height:${frameRect.height}px;`

    const copy = document.createElement('iframe')
    copy.setAttribute('sandbox', 'allow-same-origin')
    copy.setAttribute('tabindex', '-1')
    copy.style.cssText = `${place}border:0;background:transparent;z-index:1;pointer-events:none;`

    // Highlights drawn over the live page come along.
    const back = env.mount.querySelector<SVGElement>('svg[data-vel-marks="back"]')?.cloneNode(true) as SVGElement | undefined
    const front = env.mount.querySelector<SVGElement>('svg[data-vel-marks="front"]')?.cloneNode(true) as SVGElement | undefined
    if (back) clip.appendChild(back)
    clip.appendChild(copy)
    if (front) clip.appendChild(front)
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
    // Force layout now so the first painted frame already matches the live page.
    void clone.getBoundingClientRect()

    return { el: ghost, dispose: () => ghost.remove() }
  } catch {
    return null
  }
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

interface Frame {
  offset: number
  angle: number
}

function curlFrames(from: number, to: number, steps = 30): Frame[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    return { offset: t, angle: from + (to - from) * easeInOut(t) }
  })
}

/**
 * Projected x of the page's free edge for a swing of `deg` degrees, as a fraction of the width. The perspective
 * origin is the centre of the tile, so the offset from the centre is what gets magnified.
 */
function edgeX(deg: number, width: number, p: number): number {
  const a = (Math.abs(deg) * Math.PI) / 180
  const z = width * Math.sin(a)
  const cx = width / 2
  return (cx + (width * Math.cos(a) - cx) * (p / Math.max(1, p - z))) / width
}

function finish(anims: Animation[]): Promise<void> {
  return Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined)
}

/** Run one turn. Resolves when the animation is done; always leaves the DOM as it found it. */
export async function playTurn(effect: Exclude<TurnEffect, 'none'>, dir: TurnDir, ghost: Ghost, env: TurnEnv): Promise<void> {
  const { stage, root, layer } = env
  const anims: Animation[] = []
  const extra: HTMLElement[] = []
  const w = root.clientWidth
  const reset = () => {
    for (const a of anims) {
      try {
        a.cancel()
      } catch {
        /* already finished */
      }
    }
    for (const n of extra) n.remove()
    for (const p of ['transform-origin', 'backface-visibility', 'z-index', 'background-color', 'background-image', 'will-change']) stage.style.removeProperty(p)
    root.style.perspective = ''
    layer.style.perspective = ''
    ghost.dispose()
  }
  try {
    if (effect === 'fade') {
      anims.push(ghost.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-out', fill: 'forwards' }))
      await finish(anims)
      return
    }

    if (effect === 'slide') {
      const dist = Math.min(w * 0.3, 280) * (dir === 'next' ? 1 : -1)
      stage.style.willChange = 'transform, opacity'
      const opts = { duration: SLIDE_MS, easing: TURN_EASE, fill: 'forwards' as const }
      anims.push(
        ghost.el.animate([{ transform: 'translate3d(0,0,0)', opacity: 1 }, { transform: `translate3d(${-dist}px,0,0)`, opacity: 0 }], opts),
        stage.animate([{ transform: `translate3d(${dist}px,0,0)`, opacity: 0 }, { transform: 'translate3d(0,0,0)', opacity: 1 }], opts),
      )
      await finish(anims)
      return
    }

    // curl
    const persp = 1800
    root.style.perspective = `${persp}px`
    layer.style.perspective = `${persp}px`
    const next = dir === 'next'
    const frames = curlFrames(next ? 0 : -178, next ? -178 : 0)
    const flipper = next ? ghost.el : stage
    flipper.style.transformOrigin = 'left center'
    flipper.style.backfaceVisibility = 'hidden'
    flipper.style.willChange = 'transform'
    if (!next) {
      // The live page is the one that swings in: give it paper so the ghost beneath does not show through.
      stage.style.backgroundColor = env.background
      if (env.backgroundImage) stage.style.backgroundImage = env.backgroundImage
      stage.style.zIndex = '4'
      ghost.el.style.zIndex = '2'
    }
    const rotate = (a: number) => `rotateY(${a}deg)`
    const keyframes = (fn: (f: Frame) => Keyframe): Keyframe[] => frames.map((f) => ({ offset: f.offset, ...fn(f) }))
    const opts = { duration: CURL_MS, easing: 'linear', fill: 'forwards' as const }
    anims.push(flipper.animate(keyframes((f) => ({ transform: rotate(f.angle) })), opts))

    // Shade on the turning page: it darkens as it tilts away from the light.
    const shade = document.createElement('div')
    shade.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:5;transform-origin:left center;backface-visibility:hidden;will-change:transform,opacity;' +
      'background:linear-gradient(90deg,rgba(0,0,0,.10) 0%,rgba(0,0,0,.0) 35%,rgba(0,0,0,.22) 100%);'
    ;(next ? layer : root).appendChild(shade)
    extra.push(shade)
    const lift = (a: number) => Math.sin((Math.min(90, Math.abs(a)) * Math.PI) / 180)
    anims.push(shade.animate(keyframes((f) => ({ transform: rotate(f.angle), opacity: 0.15 + 0.85 * lift(f.angle) })), opts))

    // Shadow cast on the page beneath, riding the free edge.
    const castW = Math.round(w * 0.34)
    const cast = document.createElement('div')
    cast.style.cssText =
      `position:absolute;top:0;bottom:0;left:0;width:${castW}px;pointer-events:none;z-index:${next ? 2 : 1};will-change:transform,opacity;` +
      'background:linear-gradient(90deg,rgba(0,0,0,.34),rgba(0,0,0,.12) 40%,rgba(0,0,0,0));'
    layer.appendChild(cast)
    extra.push(cast)
    anims.push(
      cast.animate(
        keyframes((f) => ({
          transform: `translate3d(${Math.round(edgeX(f.angle, w, persp) * w)}px,0,0)`,
          opacity: Math.max(0, 0.95 * lift(f.angle) * (1 - Math.max(0, Math.abs(f.angle) - 90) / 88)),
        })),
        opts,
      ),
    )
    await finish(anims)
  } finally {
    reset()
  }
}
