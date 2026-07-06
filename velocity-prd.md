# 📄 Velocity — PRD + Technical Architecture
**Version:** 2.0
**Status:** Revised
**Last Updated:** 2026-05-02

---

## 1. Overview

**Velocity** is a self-hosted paste management application designed with a relentless focus on **speed, simplicity, and reliability**.

It provides a lightweight environment where users can quickly create, organize, search, and manage text-based content with support for both Markdown and rich text formatting.

The system is built around a **local-first architecture**, ensuring that user interactions feel instantaneous and are never blocked by backend latency.

---

## 2. Product Goals

- Deliver a fast, minimal, and reliable paste manager
- Enable efficient organization and retrieval of pastes
- Support Markdown and rich text workflows seamlessly
- Achieve near-zero perceived latency
- Maintain a clean, distraction-free UI

---

## 3. Target Users

- Developers managing snippets, logs, configs
- Power users who prefer keyboard-driven workflows
- Self-hosting enthusiasts
- Users who value performance over heavy UI

---

## 4. Core Features

### 4.1 Paste Creation & Editing

- Central editor (single primary interface)
- Plain text input by default
- Optional formatting preservation toggle
- Editable titles
- Real-time editing with no lag

**Paste Size Limit:** Soft cap at **1MB per paste** (accommodates large documents, full PRDs, lengthy configs, and log dumps). Content exceeding this threshold displays a size warning in the editor status bar; no hard block is enforced at this stage.

---

### 4.2 Markdown Support

- Native Markdown input
- Non-rendered by default
- Toggleable "Read Mode" for preview
- Fast switch between edit and preview

---

### 4.3 Rich Text Mode

Toggleable editing modes:
- Plain text
- Markdown
- Rich text

Supported formatting:
- Bold, italic, underline
- Headings
- Lists
- Links
- Inline + block code

Must remain lightweight and non-blocking.

---

### 4.4 Sidebar & Organization

- Sidebar listing all pastes
- CRUD operations: Create, Rename, Delete
- Group/folder support

**Group Data Model:**
- A group is a flat label (tag-style), not a nested hierarchy
- A paste belongs to exactly **one group** (or none)
- Groups are managed independently: create, rename, delete
- Deleting a group unassigns all its pastes (pastes are not deleted)

This keeps the schema simple and avoids tree-traversal complexity at this stage.

---

### 4.5 Search (Instant)

- Full-text search across titles and content
- Global search ("Search Everywhere")
- Keyboard-triggered search
- Instant result rendering

**Search Index Persistence:**
The FlexSearch index is serialized to `localStorage` after each write and hydrated on startup. This eliminates cold-start re-indexing and ensures instant search availability from the first keystroke, even with a large paste set.

---

### 4.6 Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| New Paste | `Ctrl/Cmd + N` |
| Search | `Ctrl/Cmd + F` |
| Multi-cursor | `Alt + Click` *(changed — see note)* |
| Toggle Sidebar | `Ctrl/Cmd + 1` |
| Global Search | `Ctrl/Cmd + Shift + F` *(changed — see note)* |

> **Shortcut notes:**
> - `Ctrl/Cmd + D` is removed — it conflicts with the browser's "Bookmark this page" shortcut and cannot be reliably intercepted.
> - `Double Shift` is removed — it is non-standard and unreliable across browser/OS combinations. `Ctrl/Cmd + Shift + F` is used for Global Search instead.
> - Multi-cursor via `Alt + Click` follows CodeMirror 6 native conventions.

---

### 4.7 Multi-Cursor Editing

- VS Code-like behavior via CodeMirror 6 native API
- Parallel edits across cursors
- Zero-lag updates

---

## 5. Non-Functional Requirements

### 5.1 Performance

- Sub-50ms interaction latency
- Search results under 10ms (perceived)
- Smooth handling of large paste sets
- Search index hydrated from localStorage, not rebuilt on each load

### 5.2 Reliability

- **Unsynced changes indicator:** A minimal status marker (e.g., a dot in the tab title or toolbar) signals when local state has diverged from the backend. Clears on successful sync.
- **Retry queue:** Failed writes are queued in memory and retried with exponential backoff (max 3 attempts). On persistent failure, the indicator remains visible.
- **Server-side logging:** Backend logs all write failures with timestamps and paste IDs. No user-facing notifications at this stage — clean server logs are the observability layer.
- No silent data loss under any failure mode.

### 5.3 Usability

- Minimal UI
- Keyboard-first interaction model
- No unnecessary abstractions

### 5.4 Deployment

- Easy self-hosting
- Browser-based access
- Minimal setup

### 5.5 Data Handling

- SQLite as the persistent storage layer
- User-controlled data
- Reliable retrieval
- No dependency on IndexedDB — SQLite on the local filesystem is the durability guarantee

---

## 6. UX Principles

- Minimalism over decoration
- Speed over features
- Predictability over novelty
- Content-first design

---

## 7. Technical Architecture

### 🖥️ Frontend (Primary Execution Engine)

| Concern | Choice | Rationale |
|---|---|---|
| Framework | Vite + React | Fast builds, small bundles, no overhead |
| Editor Engine | **CodeMirror 6** | Replaces Monaco. ~1/5 the bundle size, native multi-cursor, Markdown support, leaner init path |
| State Management | Zustand | Lightweight, no boilerplate, fits single-user model |
| Search Engine | **FlexSearch** | Fastest raw search latency for real-time, keystroke-level queries. Velocity's philosophy is speed over features — FlexSearch wins here |
| Styling | **CSS Modules** | Replaces plain CSS. Scoped styles, zero runtime cost, no specificity collisions at scale |

> **FlexSearch vs. Orama:** Orama offers better TypeScript DX and a richer feature set. However, Velocity's hard requirement is sub-10ms search latency on every keystroke. FlexSearch is measurably faster in raw search performance and more battle-tested for instant-search use cases. Given the product philosophy — *speed over features* — FlexSearch is the correct choice.

> **Monaco vs. CodeMirror 6:** Monaco ships ~2MB of JS and was designed as a full IDE runtime. CodeMirror 6 provides everything Velocity needs (multi-cursor, syntax highlighting, Markdown, extensible keymaps) at a fraction of the footprint, with a modern, composable API.

#### Key Decisions

- Entire interaction loop runs on client
- No blocking calls to backend
- In-memory Zustand state = primary source of truth
- Search index built client-side, serialized to localStorage for persistence
- Dirty state tracked in Zustand; retry queue managed in a dedicated service

---

### ⚙️ Backend (Thin Persistence Layer)

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | **Node.js** | Stable ecosystem, battle-tested, not cold-start sensitive for a local tool |
| Framework | Hono | Minimal, fast, excellent Node.js support |
| Database | SQLite | Zero-config, embedded, extremely fast for single-user local persistence |

> **Node.js vs. Bun:** Bun offers faster startup and native SQLite. However, Velocity is a local tool — cold-start latency is not a meaningful constraint. Node.js provides a more mature ecosystem, better operational familiarity, and Hono runs on it without friction. Bun is noted as a viable migration path if requirements change.

#### Responsibilities

- Persist pastes and groups
- Handle read/write operations
- Log write failures with context (paste ID, timestamp, error)
- No business logic in the critical path

#### Design Constraint

> Backend is **NOT part of the interaction loop.**

---

## 8. System Design Philosophy

### Local-First Architecture

- UI never waits for the server
- All actions resolve immediately in memory

### Optimistic Updates

- Assume success
- Sync happens asynchronously

### Debounced Persistence

- Batch writes
- Prevent excessive disk operations

### State Ownership

- Client state = temporary source of truth
- Backend = durability layer

### Resilient Sync

- Dirty state tracked explicitly in Zustand
- Failed writes enter a retry queue (exponential backoff, max 3 retries)
- Unsynced indicator visible to user while state has not been confirmed by backend
- All failures logged server-side; no toast notifications at this stage

---

## 9. Performance Model

### Why This Is Fast

- No network dependency for UX
- Client-side search (FlexSearch) with persistent index hydration
- Zero round-trip for reads
- CodeMirror 6 editor: minimal init overhead vs. Monaco

### Backend Role in Performance

- Latency is hidden
- Only impacts eventual consistency

### SQLite Justification

- Extremely fast for local persistence
- Zero-config
- Reliable for single-user systems
- No additional durability layer (IndexedDB) required at this stage

---

## 10. Data Flow (Zero-Lag Model)

```
1. User edits paste
2. Zustand state updates instantly
3. UI re-renders immediately
4. Dirty state flag set → unsynced indicator shown
5. Debounced sync triggered
6. Backend persists asynchronously
7a. Success → dirty flag cleared → indicator hidden
7b. Failure → write enters retry queue → indicator persists → server log written
```

---

## 11. Group / Folder Schema

```sql
-- groups table
CREATE TABLE groups (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- pastes table (relevant columns)
CREATE TABLE pastes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT,
  content    TEXT,
  group_id   INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- `group_id` is nullable — a paste with no group is ungrouped
- Deleting a group sets `group_id = NULL` on all its pastes (cascade via `ON DELETE SET NULL`)
- No nested groups at this stage

---

## 12. Scalability Strategy

### Current Scope

- Single-user
- Local-first
- No sync conflicts

### Future Evolution

If requirements expand to multi-user sync, heavy indexing, or background processing:

- Migrate backend to a Go-based system (e.g., Echo or Fiber)
- Introduce async workers
- Add indexing layer
- Evaluate Orama as FlexSearch replacement if DX and features outweigh raw speed requirements
- Evaluate Bun runtime if startup time becomes a meaningful constraint

Frontend remains unchanged across all of these migrations.

---

## 13. Out of Scope (v1)

- Authentication
- Collaboration
- Theming
- Real-time sync
- Export / import
- IndexedDB durability layer
- User-facing error notifications (server logs sufficient)

---

## 14. Success Metrics

- Paste creation < 100ms
- Search latency < 10ms (perceived, from first keystroke)
- No UI blocking under any condition
- Handles large paste sets smoothly (1MB+ individual pastes, hundreds of pastes total)
- Zero silent data loss — every write failure is logged and retried

---

## 15. Final Philosophy

> "Backend stores. Frontend thinks."

> "If the UI waits, the system is broken."

> "Speed is a feature — not an optimization."

> "Resilience is silent. The indicator shows; the queue handles it."
