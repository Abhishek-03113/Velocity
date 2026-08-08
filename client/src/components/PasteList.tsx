import { useEffect, useMemo, useState, type DragEvent } from 'react'
import type { Group, GroupFilter, Paste } from '../types'

interface PasteListProps {
  pastes: Paste[]
  groups: Group[]
  activeId: number | null
  activeGroupId: GroupFilter
  editingGroupId: number | null
  onSelect: (id: number) => void
  onDiscard: (id: number) => void
  onAssignGroup: (id: number, groupId: number | null) => void
  onGroupFilter: (id: GroupFilter) => void
  onAddGroup: () => void
  onAddNote: (groupId: number | null) => void
  onRenameGroup: (id: number, name: string) => void
  onDeleteGroup: (id: number) => void
  onEditingGroupChange: (id: number | null) => void
}

type GroupBucket = {
  id: number | null
  dropId: number | 'ungrouped'
  filterId: GroupFilter
  name: string
  color: string
  pastes: Paste[]
}

const GROUP_COLORS = ['#818cf8', '#34d399', '#fbbf24', '#c084fc', '#fb7185']

function groupColor(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length]
}

function FolderIcon() {
  return (
    <svg className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </svg>
  )
}

export default function PasteList({
  pastes,
  groups,
  activeId,
  activeGroupId,
  editingGroupId,
  onSelect,
  onDiscard,
  onAssignGroup,
  onGroupFilter,
  onAddGroup,
  onAddNote,
  onRenameGroup,
  onDeleteGroup,
  onEditingGroupChange,
}: PasteListProps) {
  const [pendingGroupName, setPendingGroupName] = useState('')
  const [draggingPasteId, setDraggingPasteId] = useState<number | null>(null)
  const [dropGroupId, setDropGroupId] = useState<number | 'ungrouped' | null>(null)

  useEffect(() => {
    if (editingGroupId == null) return
    const group = groups.find((g) => g.id === editingGroupId)
    setPendingGroupName(group?.name ?? '')
  }, [editingGroupId, groups])

  const commitGroupName = (id: number) => {
    if (pendingGroupName.trim()) onRenameGroup(id, pendingGroupName)
    onEditingGroupChange(null)
  }

  const buckets = useMemo<GroupBucket[]>(() => {
    const namedGroups = groups.map((group, index) => ({
      id: group.id,
      dropId: group.id,
      filterId: group.id as GroupFilter,
      name: group.name,
      color: groupColor(index),
      pastes: pastes.filter((paste) => paste.group_id === group.id),
    }))

    return [
      ...namedGroups,
      {
        id: null,
        dropId: 'ungrouped' as const,
        filterId: 'ungrouped' as GroupFilter,
        name: 'Ungrouped',
        color: '#64748b',
        pastes: pastes.filter((paste) => paste.group_id == null),
      },
    ]
  }, [groups, pastes])

  const draggingPaste =
    draggingPasteId == null
      ? null
      : (pastes.find((paste) => paste.id === draggingPasteId) ?? null)

  const startDrag = (e: DragEvent<HTMLElement>, paste: Paste) => {
    setDraggingPasteId(paste.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(paste.id))
  }

  const clearDrag = () => {
    setDraggingPasteId(null)
    setDropGroupId(null)
  }

  const allowGroupDrop = (e: DragEvent<HTMLElement>, groupId: number | 'ungrouped') => {
    if (draggingPasteId == null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropGroupId(groupId)
  }

  const leaveGroupDrop = (e: DragEvent<HTMLElement>) => {
    const nextTarget = e.relatedTarget
    if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) return
    setDropGroupId(null)
  }

  const dropOnGroup = (
    e: DragEvent<HTMLElement>,
    groupId: number | null,
    filterId: GroupFilter,
  ) => {
    e.preventDefault()
    const id = Number(e.dataTransfer.getData('text/plain') || draggingPasteId)
    const paste = pastes.find((item) => item.id === id)
    if (paste && paste.group_id !== groupId) {
      onAssignGroup(id, groupId)
      onGroupFilter(filterId)
    }
    clearDrag()
  }

  const renderPaste = (paste: Paste) => (
    <li key={paste.id}>
      <div
        draggable
        onDragStart={(e) => { startDrag(e, paste) }}
        onDragEnd={clearDrag}
        onClick={() => { onSelect(paste.id) }}
        className={`group flex cursor-pointer items-center gap-2 border-l py-2 pl-3.5 pr-2 text-[13px] transition-colors duration-150 ${
          activeId === paste.id
            ? 'border-v-accent bg-v-accent/10 text-v-text-strong'
            : 'border-transparent text-v-muted hover:border-v-accent/30 hover:text-v-accent-tint'
        } ${draggingPasteId === paste.id ? 'opacity-40' : ''}`}
      >
        <span className="truncate">{paste.title || 'Untitled'}</span>
        {paste.dirty && <span className="h-1 w-1 shrink-0 rounded-full bg-v-warn" />}
        <button
          aria-label="Discard paste"
          title="Discard paste"
          className="ml-auto shrink-0 rounded p-0.5 opacity-0 transition-all duration-150 hover:bg-v-border hover:text-v-danger focus-visible:opacity-100 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onDiscard(paste.id)
          }}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </li>
  )

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-2">
      <div>
        <div className="mb-2 flex items-center justify-between px-2">
          <h3 className="font-display text-[11px] font-bold uppercase tracking-widest text-v-muted">
            Organization
          </h3>
          <button
            aria-label="Create group"
            title="Create group"
            onClick={onAddGroup}
            className="rounded p-0.5 text-v-muted transition-colors duration-150 hover:bg-v-border hover:text-v-text-strong"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        <div className="space-y-0.5">
          <button
            onClick={() => { onGroupFilter(null) }}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[15px] transition-colors duration-150 ${
              activeGroupId === null
                ? 'bg-v-border text-v-text-strong'
                : 'text-v-muted hover:bg-v-border/50 hover:text-v-text-strong'
            }`}
          >
            <FolderIcon />
            <span>All notes</span>
            <span className="ml-auto text-[11px] opacity-40">{pastes.length}</span>
          </button>

          {buckets.map((bucket) => {
            const isActive = activeGroupId === bucket.filterId
            const isDropTarget = dropGroupId === bucket.dropId
            const visible = activeGroupId === null || isActive
            return (
              <section
                key={bucket.id ?? 'ungrouped'}
                onDragEnter={(e) => { allowGroupDrop(e, bucket.dropId) }}
                onDragOver={(e) => { allowGroupDrop(e, bucket.dropId) }}
                onDragLeave={leaveGroupDrop}
                onDrop={(e) => { dropOnGroup(e, bucket.id, bucket.filterId) }}
                className={`rounded-md transition-colors duration-150 ${
                  isDropTarget ? 'bg-v-accent/10 ring-1 ring-v-accent/40' : ''
                }`}
              >
                <div
                  onClick={() => { onGroupFilter(isActive ? null : bucket.filterId) }}
                  onDoubleClick={() => {
                    if (bucket.id != null) onEditingGroupChange(bucket.id)
                  }}
                  className={`group flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors duration-150 ${
                    isActive
                      ? 'bg-v-border text-v-text-strong'
                      : 'text-v-muted hover:bg-v-border/50 hover:text-v-text-strong'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: bucket.color }}
                    aria-hidden="true"
                  />
                  {bucket.id != null && editingGroupId === bucket.id ? (
                    <input
                      className="min-w-0 flex-1 rounded border border-v-accent/60 bg-v-bg px-1.5 py-0.5 text-[15px] text-v-text-strong outline-none"
                      value={pendingGroupName}
                      autoFocus
                      onClick={(e) => { e.stopPropagation() }}
                      onChange={(e) => { setPendingGroupName(e.target.value) }}
                      onBlur={() => { commitGroupName(bucket.id as number) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitGroupName(bucket.id as number)
                        if (e.key === 'Escape') onEditingGroupChange(null)
                      }}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[15px]">{bucket.name}</span>
                  )}
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
                      isActive
                        ? 'border border-v-border bg-v-bg text-v-accent-tint'
                        : 'opacity-40'
                    }`}
                  >
                    {bucket.pastes.length}
                  </span>
                  <button
                    aria-label={`New note in ${bucket.name}`}
                    title={`New note in ${bucket.name}`}
                    className="shrink-0 rounded p-0.5 opacity-0 transition-all duration-150 hover:bg-v-bg hover:text-v-accent focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddNote(bucket.id)
                    }}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                  {bucket.id != null && (
                    <button
                      aria-label="Delete group"
                      title="Delete group"
                      className="shrink-0 rounded p-0.5 opacity-0 transition-all duration-150 hover:bg-v-bg hover:text-v-danger focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteGroup(bucket.id as number)
                      }}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}

                </div>

                {visible && (
                  <ul className="ml-3 border-l border-v-border/70 pl-1">
                    {draggingPaste &&
                      isDropTarget &&
                      draggingPaste.group_id !== bucket.id && (
                        <li className="truncate border-l border-dashed border-v-accent py-2 pl-3.5 text-[13px] text-v-accent-tint">
                          {draggingPaste.title || 'Untitled'}
                        </li>
                      )}
                    {bucket.pastes.map(renderPaste)}
                    {bucket.pastes.length === 0 && !isDropTarget && (
                      <li className="py-2 pl-3.5 text-[12px] italic text-v-faint">
                        Drop notes here
                      </li>
                    )}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
