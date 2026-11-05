import { describe, expect, it } from 'vitest'
import { fingerprint, nextSend, outcomeSection, splitParagraphs } from './sent'

describe('splitParagraphs', () => {
  it('splits on blank lines and keeps fenced code whole', () => {
    const md = 'First line\nstill first\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n![shot](/api/assets/3)'
    expect(splitParagraphs(md)).toEqual(['First line\nstill first', '```ts\nconst a = 1\n\nconst b = 2\n```', '![shot](/api/assets/3)'])
  })

  it('never includes Outcome sections, up to the next heading', () => {
    const md = ['Fix the test.', '', outcomeSection('reviewer', new Date(2026, 10, 5, 10, 42), '- did it\n- tests pass', false), '## Next', '', 'Add a unit test.'].join('\n')
    expect(splitParagraphs(md)).toEqual(['Fix the test.', '## Next', 'Add a unit test.'])
  })
})

describe('nextSend', () => {
  const md = 'Fix the flaky test.\n\nDon’t touch the retry constants.'

  it('first send: title and every paragraph', () => {
    const out = nextSend({ title: 'Flaky test', markdown: md, sent: new Set(), first: true })!
    expect(out.text).toBe('Flaky test\n\nFix the flaky test.\n\nDon’t touch the retry constants.')
    expect(out.hashes).toHaveLength(2)
  })

  it('follow-up: only new paragraphs; an edited sent paragraph is not resent', () => {
    const first = nextSend({ title: 'Flaky test', markdown: md, sent: new Set(), first: true })!
    const sent = new Set(first.hashes)
    expect(nextSend({ title: 'Flaky test', markdown: md, sent, first: false })).toBeNull()
    const more = `${md}\n\nNow add a unit test.`
    expect(nextSend({ title: 'Flaky test', markdown: more, sent, first: false })!.text).toBe('Now add a unit test.')
    const spaced = 'Fix   the flaky test.\n\nDon’t touch the retry constants.'
    expect(nextSend({ title: 'x', markdown: spaced, sent, first: false })).toBeNull()
  })

  it('a selection is sent as it is and marks nothing', () => {
    const out = nextSend({ title: 'x', markdown: md, sent: new Set(), first: true, selection: '  just this  ' })!
    expect(out).toEqual({ text: 'just this', hashes: [], paragraphs: 1 })
  })
})

describe('fingerprint', () => {
  it('is stable and whitespace-insensitive', () => {
    expect(fingerprint('a  b\nc')).toBe(fingerprint('a b c'))
    expect(fingerprint('a b c')).not.toBe(fingerprint('a b d'))
  })
})
