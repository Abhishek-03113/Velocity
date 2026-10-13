import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({
  resolveMediaUrl: (href: string) => (href.startsWith('/api/assets/') ? 'blob:http://localhost/asset-1' : href),
}))

function render(node: React.ReactNode) {
  const container = document.createElement('div')
  act(() => createRoot(container).render(node))
  return { container }
}

describe('MarkdownPreview', () => {
  it('keeps blob: image URLs produced by the media resolver (sanitised before rewriting)', async () => {
    const { default: MarkdownPreview } = await import('./MarkdownPreview')
    const { container } = render(<MarkdownPreview content={'![dot](/api/assets/1)'} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:http://localhost/asset-1')
  })

  it('still strips script from note content', async () => {
    const { default: MarkdownPreview } = await import('./MarkdownPreview')
    const { container } = render(<MarkdownPreview content={'<img src=x onerror="alert(1)"><script>alert(1)</script>'} />)
    expect(container.innerHTML).not.toContain('onerror')
    expect(container.querySelector('script')).toBeNull()
  })
})
