export interface Paste {
  id: number
  title: string
  content: string | undefined
  dirty: boolean
  /** Stable client key that survives the temp-id → server-id swap (keeps editors mounted). */
  cid?: string
  group_id?: number | null
  created_at?: string
  updated_at?: string
  /** Server list rows: body is blank (empty / whitespace-only). Lets cleanup skip loading content. */
  is_empty?: boolean
  /** Server list rows: body size in bytes. */
  content_length?: number
  /** Set by the server once whiteboards live in SQLite. */
  has_whiteboard?: boolean
}

export interface Group {
  id: number
  name: string
  created_at?: string
}

export type GroupFilter = number | 'ungrouped' | null

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface PasteListItem {
  id: number
  title: string
  updated_at: string
}

export interface CreatePastePayload {
  title: string
  content: string
  group_id?: number | null
}

export interface UpdatePastePayload {
  title?: string
  content?: string
  group_id?: number | null
}

export interface CreateGroupPayload {
  name: string
}

export interface UpdateGroupPayload {
  name: string
}

export interface Asset {
  id: number
  mime_type: string
  ext: string
  byte_size: number
  sha256: string
  url: string
  created_at: string
}

export interface CreateAssetPayload {
  data_url: string
}
