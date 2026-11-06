import { afterEach, describe, expect, it } from 'vitest'
import { restoreFocus } from './focus'

const button = (label: string) => {
  const b = document.createElement('button')
  b.textContent = label
  document.body.appendChild(b)
  return b
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('restoreFocus', () => {
  it('returns focus to the element focused before the overlay opened', () => {
    const editor = button('editor')
    const inOverlay = button('overlay')
    inOverlay.focus()
    inOverlay.remove() // the overlay unmounts; focus falls back to body
    restoreFocus(editor)
    expect(document.activeElement).toBe(editor)
  })

  it('leaves focus alone when it has moved to another overlay that is still open', () => {
    const editor = button('editor')
    const settings = button('settings')
    settings.focus()
    restoreFocus(editor)
    expect(document.activeElement).toBe(settings)
  })

  it('does nothing when the previous element is gone', () => {
    const gone = button('gone')
    gone.remove()
    restoreFocus(gone)
    expect(document.activeElement).toBe(document.body)
  })
})
