import { describe, expect, it } from 'vitest'
import { toggleTask } from './markdownTasks'

describe('read-mode checklist toggling', () => {
  const doc = '# Tasks\n- [ ] one\n```\n- [ ] not a task\n```\n* [x] two\n1. [ ] three'

  it('toggles the n-th task in source order, skipping code fences', () => {
    expect(toggleTask(doc, 0)).toContain('- [x] one')
    expect(toggleTask(doc, 1)).toContain('* [ ] two')
    expect(toggleTask(doc, 2)).toContain('1. [x] three')
    expect(toggleTask(doc, 1)).toContain('- [ ] not a task')
  })

  it('ignores out-of-range indexes', () => {
    expect(toggleTask(doc, 9)).toBe(doc)
  })
})
