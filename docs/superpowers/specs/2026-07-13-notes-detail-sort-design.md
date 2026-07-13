# Note detail modal + sort/category

## Problem

Personal notes on `/home` are a fixed-height card showing up to 6 raw one-liners,
newest-first only. There's no way to write a long note comfortably, no way to
tag/group notes, and no way to reorder them.

## Data model

Add a nullable free-text tag column:

```sql
alter table notes add column category text;
```

No fixed category list — users type whatever tag they want when creating or
editing a note. A `<datalist>` sourced from categories already in use on the
current notes gives typeahead reuse without enforcing a closed set.

## Server

`src/lib/notes.ts`:
- `createNote(supabase, userId, body, category?: string | null)` — insert gains
  `category`.
- `updateNote(supabase, noteId, body, category)` — new. Update-only; RLS
  (`notes_own`, `user_id = auth.uid()`) already scopes it, no extra ownership
  check needed (matches the existing `deleteNote` comment/pattern).

`src/lib/actions.ts`:
- `createNoteFn` validator accepts optional `category` (trimmed, `null` if
  blank).
- New `updateNoteFn` server action: validates `{ id, body, category }`, calls
  `requireUser` then `updateNote`, same shape as `createNoteFn`/`deleteNoteFn`.

`src/lib/dashboard.ts`:
- Notes query selects `category` alongside the existing `id,body,created_at`.
- The mapped return type/shape currently drops `created_at` — keep it, it's
  needed for the Newest/Oldest sort.
- `limit(6)` → `limit(50)`. The 6-cap predates sorting; sorting a 6-item
  window that silently hides everything else defeats the point. 50 is a
  ponytail-style ceiling (no pagination UI), not a real limit for a personal
  notes widget.

## UI

**Notes card header** (`src/routes/home.tsx`): a small `<select>` next to
"+ New Note" — `Newest` (default) / `Oldest` / `Category (A–Z)`. Client-side
`useMemo` sort over `d.notes`; no server round-trip, no persistence of the
choice (resets to Newest on reload — acceptable for a lightweight widget).

**Note card**: unchanged trigger area (body text) becomes clickable, opening
the detail modal. The existing "⋮" kebab (quick delete with `confirm()`) stays
as-is for a fast one-click delete without opening the modal. If a `category`
is set, render a small chip next to the body (reuse the existing `.chip`
class / a category-tinted pill consistent with other pill usage in the app).

**`NoteDetail` modal** (new `src/components/NoteDetail.tsx`): reuses the
established modal chrome from `ProjectEdit.tsx` (`fixed inset-0 z-50` overlay
with backdrop blur, centered `rounded-[24px] bg-[var(--card)]` panel,
`display-title` header + circular X close button). Contents:
- Multi-line `<textarea>` for `body` (grows for long-form writing — the
  actual ask: "bisa nulis panjang").
- Text `<input>` for `category`, with a `<datalist>` populated from the
  categories already present across `d.notes` (dedup'd).
- Save button → `updateNoteFn({ id, body, category })` → `router.invalidate()`
  → close.
- Delete button (danger style, same `confirm()` UX as the kebab) →
  `deleteNoteFn` → `router.invalidate()` → close.

**`QuickNoteForm`**: gains the same category `<input>` (+ datalist) so notes
can be tagged at creation, not only retroactively via the edit modal.

## Out of scope

- No pagination/infinite scroll — 50-note ceiling is enough for a personal
  dashboard widget.
- No fixed/enforced category taxonomy, no per-category color coding beyond a
  plain chip.
- No sharing/collaboration — notes stay private to their author (existing
  RLS, untouched).
- Sort choice is not persisted (no new column/localStorage) — resets to
  Newest each load.
