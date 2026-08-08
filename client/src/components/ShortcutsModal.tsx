import { useEffect } from 'react'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

const MOD = isMac ? '⌘' : 'Ctrl'
const OPT = isMac ? '⌥' : 'Alt'

const SHORTCUTS = [
  { action: 'New note', keys: [MOD, 'N'] },
  { action: 'Close tab', keys: [MOD, 'W'] },
  { action: 'Read mode', keys: [MOD, 'E'] },
  { action: 'Toggle whiteboard', keys: [MOD, '⇧', 'D'] },
  { action: 'Inline search', keys: [MOD, 'F'] },
  { action: 'Global search', keys: [MOD, '⇧', 'F'] },
  { action: 'Toggle sidebar', keys: [MOD, '1'] },
  { action: 'Bold', keys: [MOD, 'B'] },
  { action: 'Italic', keys: [MOD, 'I'] },
  { action: 'Inline code', keys: [MOD, '⇧', 'C'] },
  { action: 'Strikethrough', keys: [MOD, '⇧', 'X'] },
  { action: 'Insert link', keys: [MOD, 'K'] },
  { action: 'Multi-cursor', keys: [OPT, 'Click'] },
  { action: 'Undo', keys: [MOD, 'Z'] },
  { action: 'Redo', keys: [MOD, '⇧', 'Z'] },
]

interface ShortcutsModalProps {
  onClose: () => void
}

export default function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => { window.removeEventListener('keydown', handleKey) }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-v-bg/70 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-v-border bg-v-surface shadow-2xl shadow-black/50"
        onClick={(e) => { e.stopPropagation() }}
      >
        <div className="flex items-center justify-between border-b border-v-border px-5 py-3.5">
          <h2 className="font-display text-sm font-semibold tracking-tight text-v-text-strong">
            Keyboard Shortcuts
          </h2>
          <button
            aria-label="Close"
            className="rounded p-1 text-v-muted transition-colors duration-150 hover:bg-v-border hover:text-v-text-strong"
            onClick={onClose}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ul className="divide-y divide-v-border/60 p-2">
          {SHORTCUTS.map(({ action, keys }) => (
            <li key={action} className="flex items-center justify-between px-3 py-2.5">
              <span className="text-sm text-v-text">{action}</span>
              <span className="flex items-center gap-1">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-v-border bg-v-bg px-1.5 py-0.5 font-mono text-[10px] text-v-text-strong"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
