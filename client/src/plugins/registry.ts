import blogReader from './blogReader'
import type { VelocityPlugin } from './types'

/** The single additive list of plugins. Adding one is a folder under plugins/ plus a line here. */
export const PLUGINS: VelocityPlugin[] = [blogReader]
