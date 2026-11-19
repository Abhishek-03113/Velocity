import { describe, expect, it } from 'vitest'
import { createSseParser } from './transport'

describe('createSseParser', () => {
  it('emits events split across chunks, ignoring comments', () => {
    const got: Array<[string, string]> = []
    const feed = createSseParser((e, d) => got.push([e, d]))
    feed(': keep-alive\n\nevent: herdr\ndata: {"a"')
    feed(':1}\n\nevent: ping\r\ndata: {}\r\n\r\n')
    feed('data: line one\ndata: line two\n\n')
    expect(got).toEqual([
      ['herdr', '{"a":1}'],
      ['ping', '{}'],
      ['message', 'line one\nline two'],
    ])
  })
})
