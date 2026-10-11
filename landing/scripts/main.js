/** Velocity landing: boots each enhancement independently so one failure never breaks the page. */

import { initMedia } from './media.js'
import {
  splitWords,
  initReveal,
  initParallax,
  initCounters,
  initNav,
  initThemeToggle,
  initCredit,
  initStatePill,
} from './motion.js'
import { initDwindle, initSliding } from './tiling.js'
import { initKeyboard } from './keyboard.js'
import { initSearchDemo, initScrolly, initThemer } from './demos.js'

const boot = (name, fn) => {
  try {
    fn()
  } catch (err) {
    console.warn(`[landing] ${name} failed`, err)
  }
}

boot('title', () => {
  const t = document.querySelector('[data-words]')
  if (t) splitWords(t)
})
boot('credit', initCredit)
boot('nav', initNav)
boot('theme-toggle', initThemeToggle)
boot('media', initMedia)
boot('reveal', initReveal)
boot('parallax', initParallax)
boot('counters', initCounters)
boot('state-pill', initStatePill)
boot('search', initSearchDemo)
boot('dwindle', initDwindle)
boot('sliding', initSliding)
boot('keyboard', initKeyboard)
boot('scrolly', initScrolly)
boot('themer', initThemer)
