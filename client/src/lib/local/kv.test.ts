import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as kv from './kv'
import { resetStorageStore, useStorageStore } from '../../store/storageStore'

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  kv.resetUsageCache()
  resetStorageStore()
})

const expected = () => {
  let n = 0
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    if (k.startsWith(kv.NAMESPACE)) n += (k.length + localStorage.getItem(k)!.length) * 2
  }
  return n
}

describe('kv', () => {
  it('namespaces keys and lists by prefix', () => {
    kv.set('p.1.m', 'a')
    kv.set('p.2.m', 'b')
    kv.set('g', 'c')
    localStorage.setItem('unrelated', 'x')
    expect(localStorage.getItem('velocity.db.v1.g')).toBe('c')
    expect(kv.keys('p.').sort()).toEqual(['p.1.m', 'p.2.m'])
    expect(kv.get('nope')).toBeNull()
  })

  it('keeps the byte estimate consistent across set / overwrite / remove', () => {
    kv.set('a', 'x'.repeat(100))
    expect(kv.usage().bytes).toBe(expected())
    kv.set('a', 'y'.repeat(10))
    kv.set('b', 'z')
    expect(kv.usage().bytes).toBe(expected())
    kv.remove('a')
    kv.remove('missing')
    expect(kv.usage().bytes).toBe(expected())
  })

  it('computes the baseline with one startup pass, then never rescans', () => {
    localStorage.setItem('velocity.db.v1.pre', 'existing')
    localStorage.setItem('other', 'ignored')
    expect(kv.usage().bytes).toBe(expected())
    const key = vi.spyOn(Storage.prototype, 'key')
    kv.set('x', '1')
    kv.set('x', '22')
    kv.remove('x')
    kv.usage()
    expect(key).not.toHaveBeenCalled()
  })

  it('reports the quota estimate', () => {
    expect(kv.usage().quota).toBe(5 * 1024 * 1024 * 2)
  })

  it.each([
    ['QuotaExceededError', 22],
    ['NS_ERROR_DOM_QUOTA_REACHED', 1014],
  ])('maps %s to StorageFullError, flags full, and clears it on success', (name, code) => {
    kv.set('keep', 'v')
    const before = kv.usage().bytes
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw Object.assign(new Error('quota'), { name, code })
    })
    expect(() => kv.set('big', 'x')).toThrow(kv.StorageFullError)
    expect(useStorageStore.getState().full).toBe(true)
    expect(kv.usage().bytes).toBe(before)
    spy.mockRestore()
    kv.set('ok', 'v')
    expect(useStorageStore.getState().full).toBe(false)
  })

  it('rethrows non-quota errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => kv.set('a', 'b')).toThrow('boom')
  })

  it('throttles store updates to one trailing publish', () => {
    vi.useFakeTimers()
    try {
      resetStorageStore()
      for (let i = 0; i < 50; i++) kv.set('k', 'x'.repeat(i + 1))
      const s = vi.fn()
      const unsub = useStorageStore.subscribe(s)
      for (let i = 0; i < 50; i++) kv.set('k', 'y'.repeat(i + 1))
      expect(s.mock.calls.length).toBeLessThanOrEqual(1)
      vi.advanceTimersByTime(1100)
      expect(useStorageStore.getState().bytes).toBe(kv.usage().bytes)
      expect(vi.getTimerCount()).toBe(0)
      unsub()
    } finally {
      vi.useRealTimers()
    }
  })
})
