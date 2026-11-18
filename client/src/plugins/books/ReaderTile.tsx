// STUB — replaced by ACC-24
import type { PluginContext, TileView } from '../types'
import type { ReaderHost } from './types'

export function readerTileView(_ctx: PluginContext, _host: ReaderHost): TileView {
  return { title: 'Reader', icon: 'doc.text', render: () => null }
}
