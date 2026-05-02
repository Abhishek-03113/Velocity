export interface Paste {
  id: number
  title: string
  content: string
  dirty: boolean
  group_id?: number | null
  created_at?: string
  updated_at?: string
}

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
}

export interface UpdatePastePayload {
  title?: string
  content?: string
}
