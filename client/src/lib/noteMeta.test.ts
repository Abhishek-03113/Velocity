import { describe, expect, it } from 'vitest'
import { countWords, derivedTitle, displayTitle, relativeTime, snippet } from './noteMeta'

describe('note metadata', () => {
  it('derives titles from the first meaningful line', () => {
    expect(derivedTitle('# Hello **world**\nbody')).toBe('Hello world')
    expect(derivedTitle('\n\n- [ ] buy milk')).toBe('buy milk')
    expect(derivedTitle('```js\ncode\n```\nAfter')).toBe('code')
    expect(derivedTitle('')).toBe('')
  })

  it('prefers explicit titles, falls back to content, then "New Note"', () => {
    expect(displayTitle({ title: 'Plan', content: '# Other' })).toBe('Plan')
    expect(displayTitle({ title: 'Untitled', content: '# Other' })).toBe('Other')
    expect(displayTitle({ title: 'Untitled', content: '' })).toBe('New Note')
  })

  it('builds a snippet that skips the title line', () => {
    expect(snippet('# Trip\nDay one: [Kyoto](http://x)\nDay two', 'Trip')).toBe('Day one: Kyoto Day two')
  })

  it('counts words without allocating arrays', () => {
    expect(countWords('  one two\n three\tfour ')).toBe(4)
    expect(countWords('')).toBe(0)
  })

  it('formats relative times like Apple Notes', () => {
    const now = new Date(2026, 3, 15, 12, 0).getTime()
    expect(relativeTime(now - 10_000, now)).toBe('Just now')
    expect(relativeTime(new Date(2026, 3, 14, 9, 0).getTime(), now)).toBe('Yesterday')
  })
})
