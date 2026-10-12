import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { COMMANDS, dynamicCommands, runCommand, type Command } from '../../lib/commands'
import { displayTitle, parseTimestamp, relativeTime } from '../../lib/noteMeta'
import { isMac } from '../../lib/platform'
import { newNote, openNote } from '../../lib/workspace'
import { pluginCommands, urlHandlerFor } from '../../plugins/host'
import type { PromptSpec } from '../../plugins/types'
import { useEditorStore } from '../../store/editorStore'
import { useGroupStore } from '../../store/groupStore'
import { cachedContent, searchNotes } from '../../store/searchStore'
import { useUiStore } from '../../store/uiStore'
import { Icon, type IconName } from '../Icon'
import { Kbd } from '../ui/Kbd'
import styles from './Overlays.module.css'

type Item =
  | { type: 'note'; id: number; title: string; detail: string; meta: string }
  | { type: 'command'; command: Command }
  | { type: 'create'; title: string }
  | { type: 'url'; label: string; detail: string; icon: IconName; open: (opts: { split: boolean }) => void }

/** Subsequence fuzzy score — lower is better, null means no match. */
function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return 0
  const direct = t.indexOf(q)
  if (direct >= 0) return direct === 0 ? 0 : 1 + direct / 100
  let ti = 0
  let gaps = 0
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    gaps += found - ti
    ti = found + 1
  }
  return 10 + gaps
}

function highlight(text: string, query: string): ReactNode {
  const q = query.trim()
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className={styles.mark}>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

function isHttpUrl(text: string): boolean {
  if (!/^https?:\/\//i.test(text)) return false
  try {
    return !!new URL(text).hostname
  } catch {
    return false
  }
}

const isSplitKey = (e: React.KeyboardEvent) => e.altKey || (isMac ? e.metaKey : e.ctrlKey)

/** Palette in prompt mode: a plugin asks for one line of text (e.g. a URL). */
function PromptPanel({ spec }: { spec: PromptSpec }) {
  const close = useUiStore((s) => s.closePalette)
  const [value, setValue] = useState(spec.initialValue ?? '')
  const [touched, setTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Read focus here, not in render: when launched from the palette, the search palette's own
    // cleanup has just handed focus back to the editor.
    const previous = document.activeElement
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  const error = spec.validate?.(value) ?? null
  const showError = touched && error != null

  const submit = (split: boolean) => {
    if (error) {
      setTouched(true)
      return
    }
    close()
    spec.onSubmit(value.trim(), { split })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      submit(isSplitKey(e))
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        data-palette-prompt
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className={styles.paletteSearch}>
          <Icon name={spec.icon ?? 'command'} size={18} />
          <span className={styles.promptChip}>{spec.title}</span>
          <input
            ref={inputRef}
            data-bare
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setTouched(true)
            }}
            placeholder={spec.placeholder}
            aria-label={spec.placeholder}
            aria-invalid={showError}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {(showError || spec.hint) && (
          <div className={`${styles.promptMessage} ${showError ? styles.promptError : ''}`} role={showError ? 'alert' : undefined}>
            {showError ? error : spec.hint}
          </div>
        )}
        <div className={styles.paletteFooter}>
          <span>
            <Kbd combo="Enter" subtle /> {spec.submitLabel ?? 'OK'}
          </span>
          {spec.splitLabel && (
            <span>
              <Kbd combo="Mod+Enter" subtle /> {spec.splitLabel}
            </span>
          )}
          <span>
            <Kbd combo="Escape" subtle /> Close
          </span>
        </div>
      </div>
    </div>
  )
}

export default function CommandPalette() {
  const mode = useUiStore((s) => s.paletteMode)
  const prompt = useUiStore((s) => s.prompt)
  if (mode === 'prompt' && prompt) return <PromptPanel spec={prompt} />
  return <SearchPalette />
}

/**
 * ⌘P / ⌘⇧P — Spotlight-style quick open. Type to search notes (full text);
 * start with “>” to run any command. ⌘↩ opens the note in a new tile.
 */
function SearchPalette() {
  const mode = useUiStore((s) => s.paletteMode)
  const close = useUiStore((s) => s.closePalette)
  // The search index warms in the background after startup and then refreshes `pastes`;
  // depending on it re-runs an already-typed query once the note text becomes searchable.
  const pastes = useEditorStore((s) => s.pastes)
  const [value, setValue] = useState(mode === 'notes' ? '' : '>')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<Element | null>(document.activeElement)

  useEffect(() => {
    inputRef.current?.focus()
    const previous = restoreFocus.current
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  const moveOnly = mode === 'move'
  const isCommand = value.startsWith('>')
  const query = isCommand ? value.slice(1).trim() : value.trim()

  const items = useMemo<Item[]>(() => {
    if (isCommand) {
      // "Move Note to Folder…" shows only this note's move targets.
      const all = (moveOnly ? dynamicCommands() : [...COMMANDS, ...pluginCommands(), ...dynamicCommands()]).filter(
        (c) => !c.paletteHidden && (!c.enabled || c.enabled()) && (!moveOnly || c.id.startsWith('note.moveTo.')),
      )
      return all
        .map((c) => ({ c, score: fuzzyScore(`${c.title} ${c.keywords ?? ''} ${c.section}`, query) }))
        .filter((x): x is { c: Command; score: number } => x.score != null)
        .sort((a, b) => a.score - b.score)
        .map(({ c }) => ({ type: 'command' as const, command: c }))
    }
    const groups = useGroupStore.getState().groups
    const groupName = (id: number | null | undefined) => groups.find((g) => g.id === id)?.name ?? 'Unfiled'
    const now = Date.now()
    if (!query) {
      return [...pastes]
        .sort((a, b) => parseTimestamp(b.updated_at) - parseTimestamp(a.updated_at))
        .slice(0, 8)
        .map((p) => ({
          type: 'note' as const,
          id: p.id,
          title: displayTitle(p, cachedContent(p.id)),
          detail: groupName(p.group_id),
          meta: relativeTime(parseTimestamp(p.updated_at), now),
        }))
    }
    const byId = new Map(pastes.map((p) => [p.id, p]))
    const seen = new Set<number>()
    const notes: Item[] = []
    // Title matches on derived titles too (notes named only by their first line).
    for (const p of pastes) {
      const title = displayTitle(p, cachedContent(p.id))
      if (fuzzyScore(title, query) !== null && title.toLowerCase().includes(query.toLowerCase())) {
        seen.add(p.id)
        notes.push({ type: 'note', id: p.id, title, detail: groupName(p.group_id), meta: relativeTime(parseTimestamp(p.updated_at), now) })
      }
    }
    for (const r of searchNotes(query, 30)) {
      const p = byId.get(r.id)
      if (!p || seen.has(r.id)) continue
      seen.add(r.id)
      notes.push({
        type: 'note',
        id: r.id,
        title: displayTitle(p, cachedContent(p.id)),
        detail: r.excerpt,
        meta: relativeTime(parseTimestamp(p.updated_at), now),
      })
    }
    const urlAction = isHttpUrl(query) ? urlHandlerFor(query) : null
    const urlItem: Item[] = urlAction
      ? [
          {
            type: 'url',
            label: urlAction.label,
            detail: `${urlAction.pluginName} · ${new URL(query).hostname}`,
            icon: urlAction.pluginIcon,
            open: urlAction.open,
          },
        ]
      : []
    return [...urlItem, ...notes.slice(0, 30), { type: 'create', title: query }]
  }, [isCommand, query, moveOnly, pastes])

  useEffect(() => setIndex(0), [value])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const activate = (item: Item | undefined, split: boolean) => {
    if (!item) return
    close()
    if (item.type === 'note') openNote(item.id, { split: split ? 'auto' : false })
    else if (item.type === 'command') runCommand(item.command)
    else if (item.type === 'url') item.open({ split })
    else {
      newNote({ split: split ? 'auto' : false })
      const id = useEditorStore.getState().activeId
      if (id != null) useEditorStore.getState().setTitle(id, item.title)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault()
      setIndex((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(items[index], e.altKey || (isMac ? e.metaKey : e.ctrlKey))
    } else if (e.key === 'Backspace' && value === '>' && !moveOnly) {
      e.preventDefault()
      setValue('')
    }
  }

  let lastSection = ''

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label={isCommand ? 'Command palette' : 'Search notes'}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className={styles.paletteSearch}>
          <Icon name={isCommand ? 'command' : 'magnifyingglass'} size={18} />
          <input
            ref={inputRef}
            data-bare
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={moveOnly ? 'Move note to folder…' : isCommand ? 'Run a command…' : 'Search notes, or type > for commands'}
            aria-label="Search"
            aria-controls="palette-list"
            aria-activedescendant={`palette-item-${index}`}
            role="combobox"
            aria-expanded="true"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className={styles.paletteList} id="palette-list" role="listbox" ref={listRef}>
          {!isCommand && !query && items.length > 0 && <div className={styles.paletteSection}>Recent</div>}
          {items.map((item, i) => {
            let sectionHeader: ReactNode = null
            if (item.type === 'command' && item.command.section !== lastSection && !query) {
              lastSection = item.command.section
              sectionHeader = <div className={styles.paletteSection}>{item.command.section}</div>
            }
            const active = i === index
            return (
              <div key={item.type === 'note' ? `n${item.id}` : item.type === 'command' ? item.command.id : item.type}>
                {sectionHeader}
                <div
                  id={`palette-item-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={active}
                  className={`${styles.paletteItem} ${active ? styles.paletteItemActive : ''}`}
                  onMouseMove={() => setIndex(i)}
                  onClick={(e) => activate(item, e.altKey || (isMac ? e.metaKey : e.ctrlKey))}
                >
                  {item.type === 'note' && (
                    <>
                      <Icon name="doc.text" size={17} className={styles.paletteIcon} />
                      <div className={styles.paletteText}>
                        <div className={styles.paletteTitle}>{highlight(item.title, query)}</div>
                        <div className={styles.paletteDetail}>{highlight(item.detail, query)}</div>
                      </div>
                      <span className={styles.paletteMeta}>{item.meta}</span>
                    </>
                  )}
                  {item.type === 'command' && (
                    <>
                      <Icon name="command" size={15} className={styles.paletteIcon} />
                      <div className={styles.paletteText}>
                        <div className={styles.paletteTitle}>{highlight(item.command.title, query)}</div>
                      </div>
                      {item.command.keys?.[0] && <Kbd combo={item.command.keys[0]} />}
                    </>
                  )}
                  {item.type === 'url' && (
                    <>
                      <Icon name={item.icon} size={17} className={styles.paletteIcon} />
                      <div className={styles.paletteText}>
                        <div className={styles.paletteTitle}>{item.label}</div>
                        <div className={styles.paletteDetail}>{item.detail}</div>
                      </div>
                    </>
                  )}
                  {item.type === 'create' && (
                    <>
                      <Icon name="square.and.pencil" size={17} className={styles.paletteIcon} />
                      <div className={styles.paletteText}>
                        <div className={styles.paletteTitle}>
                          New note “{item.title}”
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
          {items.length === 0 && <div className={styles.paletteEmpty}>No matches</div>}
        </div>
        <div className={styles.paletteFooter}>
          <span>
            <Kbd combo="Enter" subtle /> Open
          </span>
          <span>
            <Kbd combo="Mod+Enter" subtle /> Open in new tile
          </span>
          <span>
            <Kbd combo="Escape" subtle /> Close
          </span>
          <span className={styles.paletteFooterHint}>Type &gt; for commands</span>
        </div>
      </div>
    </div>
  )
}
