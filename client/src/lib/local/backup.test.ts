import { beforeEach, describe, expect, it } from 'vitest'
import { exportBackup, importBackup, validateBackup } from './backup'
import { get, keys, set } from './kv'

beforeEach(() => {
  localStorage.clear()
})

describe('backup', () => {
  it('round-trips every namespaced key and ignores foreign keys', () => {
    set('p.1.m', '{"id":1}')
    set('p.1.c', 'rhello')
    set('seq', '1')
    localStorage.setItem('velocity.prefs.v1', 'keep-me')
    const json = exportBackup()
    expect(Object.keys(JSON.parse(json).entries).sort()).toEqual(['p.1.c', 'p.1.m', 'seq'])

    localStorage.clear()
    set('p.9.m', 'stale')
    importBackup(json)
    expect(keys('').sort()).toEqual(['p.1.c', 'p.1.m', 'seq'])
    expect(get('p.1.c')).toBe('rhello')
  })

  it('counts notes and rejects files that are not backups, leaving storage untouched', () => {
    set('p.1.m', 'x')
    expect(validateBackup(exportBackup())).toBe(1)
    for (const bad of ['nope', '{}', '{"format":"velocity-backup","version":99,"entries":{}}', '{"format":"velocity-backup","version":1,"entries":{"a":1}}']) {
      expect(() => importBackup(bad)).toThrow()
    }
    expect(get('p.1.m')).toBe('x')
  })
})
