/**
 * Give focus back to `previous` when an overlay closes, unless focus has already moved on to
 * something that is still on screen. Overlays can close underneath one another (a plugin panel
 * closed while Settings is open on top of it); taking focus back then would leave the top
 * overlay without focus, so Escape and its keys would go to the editor behind it.
 */
export function restoreFocus(previous: Element | null): void {
  if (!(previous instanceof HTMLElement) || !document.contains(previous)) return
  const active = document.activeElement
  // The closing overlay is already detached here, so focus that was inside it reads as body.
  if (active && active !== document.body && document.contains(active)) return
  previous.focus({ preventScroll: true })
}
