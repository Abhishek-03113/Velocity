/** Realistic blog markup used by the extraction tests (test-only module). */

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `Sentence number ${i + 1} explains something useful about local-first software, sync engines and notes.`).join(' ')

/** A WordPress-flavoured post: nav, cookie banner, lazy images, srcset, code, table, nested list, figure, share bar, footer. */
export const WORDPRESS_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Why Local-First Wins | Example Engineering</title>
<meta property="og:title" content="Why Local-First Wins | Example Engineering">
<meta property="og:site_name" content="Example Engineering">
<meta property="og:description" content="A short argument for apps that never wait on the network.">
<meta property="article:published_time" content="2026-03-04T09:30:00+00:00">
<meta name="author" content="Ada Lovelace">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Article","datePublished":"2026-03-04T09:30:00+00:00","author":{"@type":"Person","name":"Ada Lovelace"}}]}</script>
<style>.x{color:red}</style>
</head>
<body class="post-template">
<div id="cookie-banner" class="cookie-notice"><p>We use cookies to improve your experience.</p><button>Accept</button></div>
<header class="site-header"><nav><ul><li><a href="/">Home</a></li><li><a href="/archive">Archive</a></li><li><a href="/about">About</a></li></ul></nav></header>
<div class="content-area">
<article class="post type-post">
  <header class="entry-header">
    <h1 class="entry-title">Why Local-First Wins</h1>
    <p class="byline">By <a rel="author" href="/author/ada">Ada Lovelace</a> on <time datetime="2026-03-04T09:30:00+00:00">March 4, 2026</time></p>
  </header>
  <div class="entry-content">
    <p>${filler(6)} Read the <a href="/posts/crdt-intro">CRDT primer</a> or visit <a href="https://martin.example/local-first">the original essay</a>.</p>
    <figure class="wp-block-image size-large">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/wp-content/uploads/2026/03/diagram.png"
           data-srcset="/wp-content/uploads/2026/03/diagram-300.png 300w, /wp-content/uploads/2026/03/diagram-1200.png 1200w"
           alt="Sync diagram" class="lazyload">
      <noscript><img src="/wp-content/uploads/2026/03/diagram.png" alt="Sync diagram"></noscript>
      <figcaption>The client is the source of truth.</figcaption>
    </figure>
    <h2 id="why">Why it matters<a class="anchorjs-link" href="#why" aria-label="Anchor"></a></h2>
    <p>${filler(5)}</p>
    <ul>
      <li>Instant interactions
        <ul><li>No spinners</li><li>No toasts</li></ul>
      </li>
      <li>Offline by default</li>
    </ul>
    <img srcset="/img/hero-480.jpg 480w, /img/hero-1600.jpg 1600w, /img/hero-800.jpg 800w" alt="Hero" width="800" height="400">
    <img src="https://track.example/pixel.gif" width="1" height="1" alt="">
    <h2>A tiny example</h2>
    <div class="wp-block-code"><pre class="wp-block-code"><code class="language-javascript">function save(note) {
  queue.push(note)   // never await the network
}</code></pre></div>
    <p>${filler(4)}</p>
    <table class="wp-block-table">
      <thead><tr><th>Approach</th><th>Latency</th></tr></thead>
      <tbody><tr><td>Server first</td><td>~200&nbsp;ms</td></tr><tr><td>Local first</td><td>&lt; 1 ms</td></tr></tbody>
    </table>
    <blockquote class="wp-block-quote"><p>Backend stores. Frontend thinks.</p></blockquote>
    <p>${filler(5)}</p>
  </div>
  <div class="sharedaddy"><h3>Share this:</h3><ul><li><a href="https://twitter.com/share">Twitter</a></li><li><a href="https://facebook.com/share">Facebook</a></li></ul></div>
</article>
<aside class="sidebar widget-area"><h3>Recent Posts</h3><ul><li><a href="/a">Other post one</a></li><li><a href="/b">Other post two</a></li></ul></aside>
</div>
<footer class="site-footer"><p>© 2026 Example Engineering. All rights reserved.</p></footer>
<script>window.dataLayer=[]</script>
</body></html>`

/** Medium-ish: no og:site_name, relative <base>-less URLs, figure with picture, byline link, JSON-LD only date. */
export const MEDIUM_HTML = `<!DOCTYPE html>
<html><head>
<title>Notes on Notes – by Grace Hopper – Medium</title>
<meta property="og:title" content="Notes on Notes">
<meta name="twitter:title" content="Notes on Notes">
<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2025-11-02T18:04:11.000Z","author":{"@type":"Person","name":"Grace Hopper"}}</script>
</head><body><div id="root"><article>
<div><h1 class="pw-post-title">Notes on Notes</h1></div>
<div class="byline"><a href="/@grace">Grace Hopper</a></div>
<section>
<p>${filler(8)}</p>
<h2>First, <strong>capture</strong></h2>
<figure>
  <div><picture><source srcset="/max/1400/cap.webp 1400w" type="image/webp"><img alt="A desk" src="/max/700/cap.jpg" width="700" height="466"></picture></div>
  <figcaption>My desk, 2025.</figcaption>
</figure>
<p>${filler(7)}</p>
<pre class="ib ic"><span>$ npm run dev<br>&gt; ready on :3000</span></pre>
<ol start="2"><li>Second step</li><li>Third step</li></ol>
<p>${filler(6)}</p>
</section></article></div></body></html>`

/** Too little text for Readability's default threshold: exercises the <article>/<main> fallback. */
export const TINY_HTML = `<html><head><title>Short | Tiny Blog</title><meta property="og:site_name" content="Tiny Blog"></head><body>
<nav><a href="/">home</a></nav>
<main><article><h1>Short | Tiny Blog</h1><p>Just a few words.</p><p>Second <b>line</b>.</p></article></main>
<footer>footer text</footer></body></html>`
