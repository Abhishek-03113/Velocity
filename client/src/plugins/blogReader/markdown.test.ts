import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from './markdown'

const BASE = 'https://blog.example.com/posts/hello/'

/** Convert an HTML snippet (body content) to Markdown. */
function md(html: string, opts?: { images?: boolean }): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return htmlToMarkdown(doc.body, BASE, opts)
}

describe('htmlToMarkdown: inline and headings', () => {
  it('converts headings, paragraphs and emphasis', () => {
    expect(md('<h1>Title</h1><p>Some <strong>bold</strong>, <em>italic</em> and <del>gone</del>.</p><h3>Sub</h3>')).toBe(
      '# Title\n\nSome **bold**, *italic* and ~~gone~~.\n\n### Sub',
    )
  })

  it('keeps edge whitespace outside emphasis markers', () => {
    expect(md('<p>a<strong> spaced </strong>b</p>')).toBe('a **spaced** b')
    expect(md('<p><b> </b>x</p>')).toBe('x')
  })

  it('drops emphasis inside headings', () => {
    expect(md('<h2><strong>Loud</strong> heading</h2>')).toBe('## Loud heading')
  })

  it('drops empty anchor links inside headings (WordPress/Ghost permalinks)', () => {
    expect(md('<h2 id="x"><a class="anchor" href="#x"></a>Install</h2>')).toBe('## Install')
  })

  it('collapses whitespace and renders br as a hard break', () => {
    expect(md('<p>one\n   two<br>three<br/>\n four</p>')).toBe('one two  \nthree  \nfour')
  })

  it('renders inline code, with fences longer than inner backticks', () => {
    expect(md('<p>Run <code>npm i</code> and <code>a`b</code>.</p>')).toBe('Run `npm i` and ``a`b``.')
  })

  it('escapes syntax characters that would change meaning', () => {
    expect(md('<p>2 * 3 and snake_case and _lead</p>')).toBe('2 \\* 3 and snake_case and \\_lead')
    expect(md('<p># not a heading</p>')).toBe('\\# not a heading')
    expect(md('<p>&gt; not a quote</p>')).toBe('\\> not a quote')
    expect(md('<p>- not a list</p>')).toBe('\\- not a list')
    expect(md('<p>1. not a list</p>')).toBe('1\\. not a list')
    expect(md('<p>x<br>1) nope</p>')).toBe('x  \n1\\) nope')
    expect(md('<p>&lt;div&gt; tag</p>')).toBe('\\<div> tag')
  })

  it('leaves harmless brackets alone but protects link-like text', () => {
    expect(md('<p>See [1] and [2].</p>')).toBe('See [1] and [2].')
    expect(md('<p>a [b](c) d</p>')).toBe('a \\[b\\](c) d')
  })

  it('wraps superscripts so footnote numbers stay attached', () => {
    expect(md('<p>word<sup>1</sup></p>')).toBe('word<sup>1</sup>')
  })
})

describe('htmlToMarkdown: links and images', () => {
  it('absolutises links and drops unusable ones', () => {
    expect(md('<p><a href="/about">About</a> <a href="https://x.dev/a?b=(1)">paren</a></p>')).toBe(
      '[About](https://blog.example.com/about) [paren](https://x.dev/a?b=%281%29)',
    )
    expect(md('<p><a href="javascript:alert(1)">bad</a> <a href="#fn1">1</a> <a href="">none</a></p>')).toBe('bad 1 none')
    expect(md('<p><a href="mailto:a@b.co">mail</a></p>')).toBe('[mail](mailto:a@b.co)')
  })

  it('puts images on their own line with absolute URLs', () => {
    expect(md('<p>Before <img src="/img/a.png" alt="A [1]"> after</p>')).toBe(
      'Before\n\n![A \\[1\\]](https://blog.example.com/img/a.png)\n\nafter',
    )
  })

  it('reads lazy attributes, ignores data: placeholders and tracking pixels', () => {
    expect(md('<img src="data:image/gif;base64,R0lG" data-src="/real.jpg" alt="">')).toBe(
      '![](https://blog.example.com/real.jpg)',
    )
    expect(md('<img src="data:image/gif;base64,R0lG">')).toBe('')
    expect(md('<img src="/t.gif" width="1" height="1">')).toBe('')
  })

  it('keeps linked images as a single linked image', () => {
    expect(md('<a href="/full.jpg"><img src="/thumb.jpg" alt="t"></a>')).toBe(
      '[![t](https://blog.example.com/thumb.jpg)](https://blog.example.com/full.jpg)',
    )
  })

  it('drops all images when asked', () => {
    expect(md('<p>x</p><img src="/a.png"><figure><img src="/b.png"><figcaption>cap</figcaption></figure>', { images: false })).toBe(
      'x\n\n*cap*',
    )
  })

  it('renders figures with an italic caption under the image', () => {
    expect(md('<figure class="kg-card"><img src="/a.jpg" alt="Alt"><figcaption>A nice view</figcaption></figure>')).toBe(
      '![Alt](https://blog.example.com/a.jpg)\n\n*A nice view*',
    )
    // Captions that already contain emphasis stay as-is rather than producing nested markers.
    expect(md('<figure><img src="/a.jpg"><figcaption>A <em>nice</em> view</figcaption></figure>')).toBe(
      '![](https://blog.example.com/a.jpg)\n\nA *nice* view',
    )
  })

  it('handles <picture> with a fallback img', () => {
    expect(md('<picture><source srcset="/a.webp" type="image/webp"><img src="/a.jpg" alt="p"></picture>')).toBe(
      '![p](https://blog.example.com/a.jpg)',
    )
  })
})

describe('htmlToMarkdown: code', () => {
  it('fences pre/code with the language from the class', () => {
    expect(md('<pre><code class="language-ts">const a = 1\nlet b = `x`</code></pre>')).toBe(
      '```ts\nconst a = 1\nlet b = `x`\n```',
    )
  })

  it('uses a longer fence when the code contains backtick fences', () => {
    expect(md('<pre><code>```js\nx\n```</code></pre>')).toBe('````\n```js\nx\n```\n````')
  })

  it('reads the language from lang-x, a wrapper div, or highlight-source-x', () => {
    expect(md('<pre class="lang-py"><code>print(1)</code></pre>')).toBe('```py\nprint(1)\n```')
    expect(md('<div class="highlight highlight-source-rust"><pre>fn main() {}</pre></div>')).toBe('```rust\nfn main() {}\n```')
  })

  it('reads highlighter markup: spans, br and per-line divs; ignores copy buttons', () => {
    expect(
      md('<pre><button>Copy</button><code><span class="k">if</span> x:<br>    <span class="n">y</span></code></pre>'),
    ).toBe('```\nif x:\n    y\n```')
    expect(md('<pre><div class="line">a</div><div class="line">b</div></pre>')).toBe('```\na\nb\n```')
  })

  it('preserves blank lines inside code', () => {
    expect(md('<pre><code>a\n\n\nb</code></pre>')).toBe('```\na\n\n\nb\n```')
  })
})

describe('htmlToMarkdown: lists, quotes, tables', () => {
  it('nests lists with two-space indent for bullets', () => {
    expect(md('<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>')).toBe(
      '- a\n  - b\n    - c\n- d',
    )
  })

  it('numbers ordered lists from start and indents by marker width', () => {
    expect(md('<ol start="3"><li>x<ol><li>y</li></ol></li><li>z</li></ol>')).toBe('3. x\n   1. y\n4. z')
  })

  it('renders task list items', () => {
    expect(
      md('<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>'),
    ).toBe('- [x] done\n- [ ] todo')
  })

  it('separates multi-paragraph list items with a blank line', () => {
    expect(md('<ul><li><p>one</p><p>two</p></li><li><p>three</p></li></ul>')).toBe('- one\n\n  two\n\n- three')
  })

  it('renders nested blockquotes', () => {
    expect(md('<blockquote><p>outer</p><blockquote><p>inner</p></blockquote></blockquote>')).toBe(
      '> outer\n>\n> > inner',
    )
  })

  it('renders GFM tables, escaping pipes and flattening newlines', () => {
    expect(
      md(
        '<table><thead><tr><th>Name</th><th>Use</th></tr></thead><tbody>' +
          '<tr><td>a|b</td><td>line<br>two</td></tr><tr><td>c</td></tr></tbody></table>',
      ),
    ).toBe('| Name | Use |\n| --- | --- |\n| a\\|b | line two |\n| c |  |')
  })

  it('uses the first row as header when there are no th cells', () => {
    expect(md('<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>')).toBe(
      '| 1 | 2 |\n| --- | --- |\n| 3 | 4 |',
    )
  })

  it('renders definition lists', () => {
    expect(md('<dl><dt>Term</dt><dd>Meaning of it</dd></dl>')).toBe('**Term**\n\nMeaning of it')
  })

  it('renders hr', () => {
    expect(md('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb')
  })
})

describe('htmlToMarkdown: noise and structure', () => {
  it('skips non-content elements and hidden nodes', () => {
    expect(
      md(
        '<nav>Menu</nav><script>x()</script><style>p{}</style><noscript>js</noscript><iframe src="x"></iframe>' +
          '<svg><text>icon</text></svg><button>Share</button><form><input></form><aside>Related</aside>' +
          '<div hidden>secret</div><p style="display: none">gone</p><p>kept</p><footer>©</footer>',
      ),
    ).toBe('kept')
  })

  it('treats text mixed with block children and divs as paragraphs', () => {
    expect(md('<div>loose text<div>inner</div>tail</div>')).toBe('loose text\n\ninner\n\ntail')
  })

  it('never emits more than one blank line between blocks', () => {
    const out = md('<p>a</p><p></p><p>&nbsp;</p><div><br></div><p>b</p>')
    expect(out).toBe('a\n\nb')
    expect(out).not.toMatch(/\n{3,}/)
  })

  it('accepts a DocumentFragment', () => {
    const frag = document.createDocumentFragment()
    const p = document.createElement('p')
    p.textContent = 'frag'
    frag.append(p)
    expect(htmlToMarkdown(frag, BASE)).toBe('frag')
  })
})
