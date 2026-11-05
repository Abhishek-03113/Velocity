import blogReader from './blogReader'
import herdr from './herdr'
import latex from './latex'
import type { VelocityPlugin } from './types'

/** The single additive list of plugins. Adding one is a folder under plugins/ plus a line here. */
export const PLUGINS: VelocityPlugin[] = [blogReader, herdr, latex]
