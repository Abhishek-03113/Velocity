import { useEffect, useState } from 'react'
import type { Paste } from '../types'
import type { Group, GroupFilter } from '../types'
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

  useEffect(() => {
    if (editingGroupId == null) return
    const group = groups.find((g) => g.id === editingGroupId)
    setPendingGroupName(group?.name ?? '')
  }, [editingGroupId, groups])

  const commitGroupName = (id: number) => {
    if (pendingGroupName.trim()) onRenameGroup(id, pendingGroupName)
    onEditingGroupChange(null)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.sectionHeader}>
        <span>GROUPS</span>
        <button className={styles.addGroup} onClick={onAddGroup} title="Create group">
          +
        </button>
      </div>
      <div className={styles.groupList}>
        <button
          className={`${styles.groupItem} ${activeGroupId === null ? styles.groupActive : ''}`}
          onClick={() => onGroupFilter(null)}
        >
          <span>All pastes</span>
        </button>
        <button
          className={`${styles.groupItem} ${activeGroupId === 'ungrouped' ? styles.groupActive : ''}`}
          onClick={() => onGroupFilter('ungrouped')}
        >
          <span>Ungrouped</span>
        </button>
        {groups.map((group) => (
          <div
            key={group.id}
            className={`${styles.groupItem} ${activeGroupId === group.id ? styles.groupActive : ''}`}
            onClick={() => onGroupFilter(group.id)}
            onDoubleClick={() => onEditingGroupChange(group.id)}
          >
            {editingGroupId === group.id ? (
              <input
                className={styles.groupInput}
                value={pendingGroupName}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setPendingGroupName(e.target.value)}
                onBlur={() => commitGroupName(group.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitGroupName(group.id)
                  if (e.key === 'Escape') onEditingGroupChange(null)
                }}
              />
            ) : (
              <span className={styles.groupName}>{group.name}</span>
            )}
            <button
              className={styles.deleteGroup}
              title="Delete group"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteGroup(group.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className={styles.sectionHeader}>PASTES</div>
      <ul className={styles.list}>
        {pastes.map((paste) => (
          <li
            key={paste.id}
            className={`${styles.item} ${activeId === paste.id ? styles.active : ''}`}
            onClick={() => onSelect(paste.id)}
          >
            <span className={styles.title}>{paste.title || 'Untitled'}</span>
            <select
              className={styles.groupSelect}
              title="Assign group"
              value={paste.group_id ?? ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const nextValue = e.target.value ? Number(e.target.value) : null
                onAssignGroup(paste.id, nextValue)
              }}
            >
              <option value="">No group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
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
        ))}
        {pastes.length === 0 && (
          <li className={styles.empty}>No pastes in this group</li>
        )}
      </ul>
    </div>
  )
}
