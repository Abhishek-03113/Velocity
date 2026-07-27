import { useEffect, useMemo, useState, type DragEvent } from 'react'
import type { Group, GroupFilter } from '../types'
import type { Paste } from '../types'
import styles from './PasteList.module.css'

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

const GROUP_COLORS = ['#7aa7ff', '#82d39e', '#d4a96a', '#c58de2', '#d97878']

function groupColor(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length]
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
      filterId: group.id,
      name: group.name,
      color: groupColor(index),
      pastes: pastes.filter((paste) => paste.group_id === group.id),
    }))

    return [
      ...namedGroups,
      {
        id: null,
        dropId: 'ungrouped',
        filterId: 'ungrouped',
        name: 'Ungrouped',
        color: '#777',
        pastes: pastes.filter((paste) => paste.group_id == null),
      },
    ]
  }, [groups, pastes])

  const draggingPaste = draggingPasteId == null
    ? null
    : pastes.find((paste) => paste.id === draggingPasteId) ?? null

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

  const dropOnGroup = (e: DragEvent<HTMLElement>, groupId: number | null, filterId: GroupFilter) => {
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
    <li
      key={paste.id}
      className={`${styles.item} ${activeId === paste.id ? styles.active : ''} ${draggingPasteId === paste.id ? styles.dragging : ''}`}
      draggable
      onDragStart={(e) => startDrag(e, paste)}
      onDragEnd={clearDrag}
      onClick={() => onSelect(paste.id)}
    >
      <span className={styles.dragHandle} aria-hidden="true">⋮⋮</span>
      <span className={styles.title}>{paste.title || 'Untitled'}</span>
      <button
        className={styles.discard}
        title="Discard paste"
        onClick={(e) => {
          e.stopPropagation()
          onDiscard(paste.id)
        }}
      >
        ×
      </button>
    </li>
  )

  return (
    <div className={styles.panel}>
      <div className={styles.sectionHeader}>
        <span>GROUPS</span>
        <button className={styles.addGroup} onClick={onAddGroup} title="Create group">
          +
        </button>
      </div>
      <div className={styles.groupStack}>
        <button
          className={`${styles.allPastes} ${activeGroupId === null ? styles.groupActive : ''}`}
          onClick={() => onGroupFilter(null)}
        >
          <span>All pastes</span>
        </button>
        {buckets.map((bucket) => (
          <section
            key={bucket.id ?? 'ungrouped'}
            className={`${styles.groupSection} ${dropGroupId === bucket.dropId ? styles.groupDropTarget : ''}`}
            onDragEnter={(e) => allowGroupDrop(e, bucket.dropId)}
            onDragOver={(e) => allowGroupDrop(e, bucket.dropId)}
            onDragLeave={leaveGroupDrop}
            onDrop={(e) => dropOnGroup(e, bucket.id, bucket.filterId)}
          >
            <div
              className={`${styles.groupItem} ${activeGroupId === bucket.filterId ? styles.groupActive : ''}`}
              onClick={() => onGroupFilter(bucket.filterId)}
              onDoubleClick={() => {
                if (bucket.id != null) onEditingGroupChange(bucket.id)
              }}
            >
              <span
                className={styles.groupDot}
                style={{ backgroundColor: bucket.color }}
              />
              {bucket.id != null && editingGroupId === bucket.id ? (
                <input
                  className={styles.groupInput}
                  value={pendingGroupName}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setPendingGroupName(e.target.value)}
                  onBlur={() => commitGroupName(bucket.id!)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitGroupName(bucket.id!)
                    if (e.key === 'Escape') onEditingGroupChange(null)
                  }}
                />
              ) : (
                <span className={styles.groupName}>{bucket.name}</span>
              )}
              <span className={styles.count}>{bucket.pastes.length}</span>
              {bucket.id != null && (
                <button
                  className={styles.deleteGroup}
                  title="Delete group"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteGroup(bucket.id!)
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <ul className={styles.groupPastes}>
              {draggingPaste && dropGroupId === bucket.dropId && draggingPaste.group_id !== bucket.id && (
                <li className={styles.dropSlot}>{draggingPaste.title || 'Untitled'}</li>
              )}
              {bucket.pastes.map(renderPaste)}
              {bucket.pastes.length === 0 && dropGroupId !== bucket.dropId && (
                <li className={styles.empty}>Drop notes here</li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
