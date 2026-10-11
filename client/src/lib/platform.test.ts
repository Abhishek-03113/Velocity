import { describe, expect, it } from 'vitest'
import { detectMac } from './platform'

describe('detectMac', () => {
  it.each(['macOS', 'MacIntel', 'MacPPC', 'iPhone', 'iPad', 'iPod'])('treats %s as Apple', (p) => {
    expect(detectMac(p)).toBe(true)
  })
  it.each(['Windows', 'Win32', 'Linux', 'Linux x86_64', 'Android', 'CrOS', '', undefined])('treats %s as non-Apple', (p) => {
    expect(detectMac(p)).toBe(false)
  })
})
