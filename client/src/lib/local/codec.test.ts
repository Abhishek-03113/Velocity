import { describe, expect, it } from 'vitest'
import { pack, unpack } from './codec'

describe('codec', () => {
  it('round-trips empty, short and non-BMP text', () => {
    for (const text of ['', 'hi', 'emoji 😀🎉 and 𝒳 '.repeat(50), 'line\r\nbreak\n'.repeat(30)]) {
      expect(unpack(pack(text))).toBe(text)
    }
  })

  it('compresses repetitive text and tags it self-describingly', () => {
    const text = 'the quick brown fox '.repeat(200)
    const packed = pack(text)
    expect(packed[0]).toBe('z')
    expect(packed.length).toBeLessThan(text.length)
    expect(unpack(packed)).toBe(text)
  })

  it('keeps raw when compression would not help', () => {
    expect(pack('short')).toBe('rshort')
    expect(pack('')).toBe('r')
  })

  it('throws on unknown tags and corrupt payloads instead of returning empty', () => {
    expect(() => unpack('?abc')).toThrow()
    expect(() => unpack('')).toThrow()
    expect(() => unpack('z')).toThrow()
  })
})
