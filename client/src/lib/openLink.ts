import { linkHandlerFor } from '../plugins/host'
import { useUiStore } from '../store/uiStore'

/**
 * Open a `velocity://` link from a note through the plugin that handles it.
 * Returns true for any velocity: link (handled or flashed), false for other hrefs.
 */
export function openVelocityLink(href: string, split: boolean): boolean {
  if (!/^velocity:/i.test(href.trim())) return false
  const handler = linkHandlerFor(href.trim())
  if (handler) handler.open({ split })
  else useUiStore.getState().showFlash('Nothing can open this link')
  return true
}
