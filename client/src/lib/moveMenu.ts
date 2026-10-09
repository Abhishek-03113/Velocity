import type { MenuItem } from '../components/ui/ContextMenu'
import { useEditorStore } from '../store/editorStore'
import { useGroupStore } from '../store/groupStore'
import { moveNoteToNewFolder } from './workspace'

/**
 * "Move to Folder" menu body for one note: folders, then New Folder…, then
 * Unfiled last. Shared by row menus, the row chip, the toolbar and drop menus.
 */
export function moveMenuItems(noteId: number): MenuItem[] {
  const paste = useEditorStore.getState().pastes.find((p) => p.id === noteId)
  const { groups } = useGroupStore.getState()
  const { assignGroup } = useEditorStore.getState()
  return [
    ...groups.map((g) => ({
      label: g.name,
      icon: 'folder' as const,
      checked: paste?.group_id === g.id,
      onSelect: () => assignGroup(noteId, g.id),
    })),
    ...(groups.length ? [{ separator: true } as const] : []),
    { label: 'New Folder…', icon: 'folder.badge.plus' as const, onSelect: () => moveNoteToNewFolder(noteId) },
    {
      label: 'Unfiled',
      icon: 'doc.plaintext' as const,
      checked: paste?.group_id == null,
      onSelect: () => assignGroup(noteId, null),
    },
  ]
}
