import { memo } from 'react'

/**
 * SF Symbols-style line icons (24×24, 1.6px rounded strokes). Names follow the
 * SF Symbols they imitate so designers can map them 1:1.
 */
const PATHS = {
  'sidebar.left': (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M9.5 4.5v15M5.75 8.5h1.5M5.75 11h1.5" />
    </>
  ),
  'square.and.pencil': (
    <>
      <path d="M12.5 4.5H7a3 3 0 0 0-3 3v9.5a3 3 0 0 0 3 3h9.5a3 3 0 0 0 3-3V11.5" />
      <path d="M17.6 3.9a1.9 1.9 0 0 1 2.7 2.7L12.6 14.3 9.5 15l.7-3.1 7.4-8Z" />
    </>
  ),
  magnifyingglass: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  'folder': (
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
  ),
  'folder.badge.plus': (
    <>
      <path d="M12 18.5H5.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V12" />
      <path d="M18 15v6M15 18h6" />
    </>
  ),
  tray: (
    <>
      <path d="M4 13.5 6.3 6a2 2 0 0 1 1.9-1.4h7.6A2 2 0 0 1 17.7 6l2.3 7.5v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M4 13.5h4.5l1 2h5l1-2H20" />
    </>
  ),
  'doc.text': (
    <>
      <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 15.5h5" />
    </>
  ),
  'doc.plaintext': (
    <>
      <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3.5V8h4.5" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.5c-1.8-1.3-4.3-2-7.5-2v13c3.2 0 5.7.7 7.5 2 1.8-1.3 4.3-2 7.5-2v-13c-3.2 0-5.7.7-7.5 2Z" />
      <path d="M12 6.5v13" />
    </>
  ),
  pencil: (
    <path d="M16.3 4.7a2 2 0 0 1 2.9 2.9L8.5 18.3 4.5 19.5l1.2-4Z" />
  ),
  scribble: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M7 14c1.5-3.5 3-3.5 4.3-.5s2.9 3 4.7-1" />
    </>
  ),
  'rectangle.split.2x1': (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M12 4.5v15" />
    </>
  ),
  'rectangle.split.1x2': (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M3 12h18" />
    </>
  ),
  'rectangle.3.group': (
    <>
      <rect x="3" y="4.5" width="9" height="15" rx="2.2" />
      <rect x="14" y="4.5" width="7" height="6.5" rx="2" />
      <rect x="14" y="13" width="7" height="6.5" rx="2" />
    </>
  ),
  'arrow.up.left.and.arrow.down.right': (
    <path d="M9.5 4.5h-5v5M4.5 4.5l6 6M14.5 19.5h5v-5M19.5 19.5l-6-6" />
  ),
  'arrow.down.right.and.arrow.up.left': (
    <path d="M5 10.5h5v-5M10 10.5l-5.5-5.5M19 13.5h-5v5M14 13.5l5.5 5.5" />
  ),
  xmark: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  plus: <path d="M12 5v14M5 12h14" />,
  'plus.circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  ellipsis: (
    <>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  'ellipsis.circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="8.3" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.7" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  gearshape: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 9.5h.01M9.3 9.5h.01M12.6 9.5h.01M15.9 9.5h.01M18.2 9.5h.01M6 12.5h.01M18.2 12.5h.01M8.5 15h7" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
      <path d="M6.5 6.5l.8 11.6a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-11.6M10 10.5v6M14 10.5v6" />
    </>
  ),
  'chevron.right': <path d="m9.5 6 6 6-6 6" />,
  'chevron.down': <path d="m6 9.5 6 6 6-6" />,
  'chevron.left': <path d="m14.5 6-6 6 6 6" />,
  checkmark: <path d="m5.5 12.5 4.2 4.2 8.8-9.4" />,
  'checkmark.circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.3 2.4 2.4 4.8-5.2" />
    </>
  ),
  'exclamationmark.triangle': (
    <>
      <path d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3Z" />
      <path d="M12 9.5v4M12 16.6h.01" />
    </>
  ),
  'arrow.triangle.2.circlepath': (
    <>
      <path d="M19 9.5A7.5 7.5 0 0 0 5.6 7.4M5 14.5a7.5 7.5 0 0 0 13.4 2.1" />
      <path d="M5.5 4v3.5H9M18.5 20v-3.5H15" />
    </>
  ),
  'square.and.arrow.down': (
    <>
      <path d="M8 10.5l4 4 4-4M12 3.5v11" />
      <path d="M5 13.5v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </>
  ),
  'doc.on.doc': (
    <>
      <rect x="8" y="7.5" width="11" height="13" rx="2" />
      <path d="M16 7.5V5.5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h1" />
    </>
  ),
  'circle.lefthalf.filled': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17Z" fill="currentColor" />
    </>
  ),
  command: (
    <path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9Zm0 0h6M9 9v6m6-6V6.5A2.5 2.5 0 1 1 17.5 9H15Zm0 0v6m0 0h2.5a2.5 2.5 0 1 1-2.5 2.5V15Zm0 0H9m0 0v2.5A2.5 2.5 0 1 1 6.5 15H9Z" />
  ),
  'arrow.turn.down.left': <path d="M18.5 5.5v6a3 3 0 0 1-3 3h-10M9 10.5l-4 4 4 4" />,
  'textformat.size': (
    <>
      <path d="M3.5 18.5 8 6.5l4.5 12M5.2 14h5.6" />
      <path d="M13.5 18.5l3.3-8 3.2 8M14.6 15.8h4.4" />
    </>
  ),
  'rectangle.portrait.and.arrow.right': (
    <>
      <path d="M13.5 5.5v-1a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-1" />
      <path d="M10 12h10M17 9l3 3-3 3" />
    </>
  ),
  'arrow.right.square': (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 12h8M13 9l3 3-3 3" />
    </>
  ),
  'wifi.slash': (
    <>
      <path d="M4 9.5a12 12 0 0 1 5-2.6M14.6 7a12 12 0 0 1 5.4 2.5M7 12.8a7.5 7.5 0 0 1 3-1.6M15.8 12.4c.4.2.8.5 1.2.8M10 16a3 3 0 0 1 4 0M12 19.5h.01" />
      <path d="m4 4 16 16" />
    </>
  ),
} as const

export type IconName = keyof typeof PATHS

interface IconProps {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
  title?: string
}

function IconBase({ name, size = 18, className, strokeWidth = 1.6, title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  )
}

export const Icon = memo(IconBase)
