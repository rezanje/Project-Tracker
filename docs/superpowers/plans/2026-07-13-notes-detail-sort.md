# Note Detail Modal + Sort/Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user open a personal note in a big modal to read/write long text and tag it with a free-text category, and sort the notes list by newest/oldest/category.

**Architecture:** Add a nullable `category` column to `notes`. Extend the existing `createNote`/add `updateNote` in `src/lib/notes.ts`, expose `updateNoteFn` alongside the existing `createNoteFn`/`deleteNoteFn` in `src/lib/actions.ts`, widen what `fetchDashboard` selects/returns for notes, then wire a sort dropdown + a new `NoteDetail` modal into `src/routes/home.tsx`. `QuickNoteForm` gets a matching category field.

**Tech Stack:** TanStack Start server functions, Supabase (Postgres + RLS), React, Vitest (integration tests against the real remote DB via `.dev.vars`).

**Spec:** `docs/superpowers/specs/2026-07-13-notes-detail-sort-design.md`

---

## ⚠️ Manual step before Task 2's tests will pass

Task 1 writes a migration file. It does **not** get applied automatically —
per this repo's `CLAUDE.md`, schema changes go to the remote Supabase DB via
the Dashboard SQL Editor or `supabase db push` with the pooler URL, and no
agent should hold or use the DB password. **Whoever executes this plan must
stop after Task 1 and ask the human operator to apply the migration**, the
same way migration `0026_reject_signup.sql` from the previous feature was
left pending. Task 2's test suite queries the real remote `notes` table and
will fail with a Postgres "column category does not exist" error until this
is done.

---

### Task 1: Add `category` column to `notes`

**Files:**
- Create: `supabase/migrations/0027_notes_category.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Free-text tag for personal notes (no fixed taxonomy — user types anything).
alter table notes add column category text;
```

- [ ] **Step 2: Ask the human operator to apply it**

Tell the user: "Migration `0027_notes_category.sql` needs applying to the
remote DB before I continue — same flow as `0026`: Supabase Dashboard → SQL
Editor → paste the file → Run, then:

```bash
npx supabase migration repair --status applied 0027 --db-url "<pooler-url>"
```

Let me know once it's applied." Wait for confirmation before starting Task 2.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0027_notes_category.sql
git commit -m "feat: add category column to notes"
```

---

### Task 2: `createNote`/`updateNote` in the data layer

**Files:**
- Modify: `src/lib/notes.ts`
- Test: `src/lib/notes.test.ts` (new)

Current `src/lib/notes.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

/** Personal note create/delete. RLS (notes_own) scopes both to user_id = auth.uid(),
 *  so no ownership check is needed here beyond passing the caller's id. */
export async function createNote(supabase: SupabaseClient, userId: string, body: string): Promise<void> {
  const { error } = await supabase.from('notes').insert({ user_id: userId, body })
  if (error) throw error
}

export async function deleteNote(supabase: SupabaseClient, noteId: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('id', noteId)
  if (error) throw error
}
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/notes.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { createNote, updateNote } from './notes'

// Creds from gitignored .dev.vars (keeps service_role key out of the repo).
const env = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function makeSignedInUser(prefix: string) {
  const email = `${prefix}.${Date.now()}@gmail.com`
  const password = 'Babikeguling1!'
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: prefix },
  })
  const uid = u.user!.id
  const userClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!)
  await userClient.auth.signInWithPassword({ email, password })
  return { uid, userClient }
}

test('createNote inserts a note with a category for its author (RLS path)', async () => {
  const { uid, userClient } = await makeSignedInUser('note-create')
  try {
    await createNote(userClient, uid, 'Remember the thing', 'Ideas')

    const { data: rows } = await admin.from('notes').select('user_id, body, category').eq('user_id', uid)
    expect(rows).toHaveLength(1)
    expect(rows![0].body).toBe('Remember the thing')
    expect(rows![0].category).toBe('Ideas')
    expect(rows![0].user_id).toBe(uid)
  } finally {
    await admin.from('notes').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test('createNote defaults category to null when omitted', async () => {
  const { uid, userClient } = await makeSignedInUser('note-nocat')
  try {
    await createNote(userClient, uid, 'No tag here')

    const { data: rows } = await admin.from('notes').select('category').eq('user_id', uid)
    expect(rows).toHaveLength(1)
    expect(rows![0].category).toBeNull()
  } finally {
    await admin.from('notes').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test('updateNote edits body and category for the owning user (RLS path)', async () => {
  const { uid, userClient } = await makeSignedInUser('note-update')
  try {
    await createNote(userClient, uid, 'Original body', 'Work')
    const { data: created } = await admin.from('notes').select('id').eq('user_id', uid).single()

    await updateNote(userClient, created!.id as string, 'Edited body', 'Personal')

    const { data: rows } = await admin.from('notes').select('body, category').eq('id', created!.id)
    expect(rows).toHaveLength(1)
    expect(rows![0].body).toBe('Edited body')
    expect(rows![0].category).toBe('Personal')
  } finally {
    await admin.from('notes').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/notes.test.ts`
Expected: FAIL — `createNote` doesn't accept a 4th argument yet, `updateNote`
doesn't exist (`TypeError: updateNote is not a function` / TS error if
running through the type-checked path).

- [ ] **Step 3: Implement `createNote`'s category param and `updateNote`**

Replace `src/lib/notes.ts` with:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

/** Personal note create/update/delete. RLS (notes_own) scopes all three to
 *  user_id = auth.uid(), so no ownership check is needed here beyond passing
 *  the caller's id on create. */
export async function createNote(
  supabase: SupabaseClient,
  userId: string,
  body: string,
  category: string | null = null,
): Promise<void> {
  const { error } = await supabase.from('notes').insert({ user_id: userId, body, category })
  if (error) throw error
}

export async function updateNote(
  supabase: SupabaseClient,
  noteId: string,
  body: string,
  category: string | null,
): Promise<void> {
  const { error } = await supabase.from('notes').update({ body, category }).eq('id', noteId)
  if (error) throw error
}

export async function deleteNote(supabase: SupabaseClient, noteId: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('id', noteId)
  if (error) throw error
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/notes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/notes.ts src/lib/notes.test.ts
git commit -m "feat: add note category tagging and updateNote"
```

---

### Task 3: Server actions — `createNoteFn` category + new `updateNoteFn`

**Files:**
- Modify: `src/lib/actions.ts:15-27` (createNoteFn), add new export

Current relevant block in `src/lib/actions.ts`:

```typescript
export const createNoteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const body = (d as { body?: unknown })?.body
    if (typeof body !== 'string' || !body.trim()) throw new Error('body required')
    return { body: body.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await createNote(supabase, user.id, data.body)
    flush(headers)
    return { ok: true }
  })
```

- [ ] **Step 1: Update the import and `createNoteFn`, add `updateNoteFn`**

Change the import line:

```typescript
import { createNote, deleteNote, updateNote } from './notes'
```

Replace `createNoteFn` and insert `updateNoteFn` right after it:

```typescript
export const createNoteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { body, category } = (d ?? {}) as { body?: unknown; category?: unknown }
    if (typeof body !== 'string' || !body.trim()) throw new Error('body required')
    const cat = typeof category === 'string' && category.trim() ? category.trim() : null
    return { body: body.trim(), category: cat }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await createNote(supabase, user.id, data.body, data.category)
    flush(headers)
    return { ok: true }
  })

export const updateNoteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { id, body, category } = (d ?? {}) as { id?: unknown; body?: unknown; category?: unknown }
    if (typeof id !== 'string' || !id) throw new Error('id required')
    if (typeof body !== 'string' || !body.trim()) throw new Error('body required')
    const cat = typeof category === 'string' && category.trim() ? category.trim() : null
    return { id, body: body.trim(), category: cat }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await updateNote(supabase, data.id, data.body, data.category)
    flush(headers)
    return { ok: true }
  })
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: No errors found

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions.ts
git commit -m "feat: add updateNoteFn, thread category through createNoteFn"
```

---

### Task 4: Widen what `fetchDashboard` returns for notes

**Files:**
- Modify: `src/lib/dashboard.ts:46` (type), `src/lib/dashboard.ts:77` (query), `src/lib/dashboard.ts:187` (mapping)

- [ ] **Step 1: Update the `DashboardData['notes']` type**

In `src/lib/dashboard.ts`, change:

```typescript
  notes: Array<{ id: string; body: string }>
```

to:

```typescript
  notes: Array<{ id: string; body: string; category: string | null; created_at: string }>
```

- [ ] **Step 2: Widen the select and raise the cap**

Change:

```typescript
        supabase.from('notes').select('id,body,created_at').order('created_at', { ascending: false }).limit(6),
```

to:

```typescript
        supabase.from('notes').select('id,body,category,created_at').order('created_at', { ascending: false }).limit(50),
```

(The 6-item cap predates sorting; a personal notes widget doesn't need real
pagination, but hiding everything past item 6 defeats a sort control.)

- [ ] **Step 3: Update the mapping to keep `category`/`created_at`**

Change:

```typescript
      notes: (notes ?? []).map((n) => ({ id: n.id as string, body: n.body as string })),
```

to:

```typescript
      notes: (notes ?? []).map((n) => ({
        id: n.id as string,
        body: n.body as string,
        category: (n.category as string | null) ?? null,
        created_at: n.created_at as string,
      })),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: No errors found — this will surface any other place that destructures
`DashboardData['notes']` items and assumed only `{ id, body }`; there are none
today besides `src/routes/home.tsx`, which Task 6 updates.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard.ts
git commit -m "feat: return note category/created_at, raise notes cap to 50"
```

---

### Task 5: `QuickNoteForm` gets a category field

**Files:**
- Modify: `src/components/QuickNoteForm.tsx`

Current file:

```typescript
import { useState } from 'react'
import { StickyNote } from 'lucide-react'
import { createNoteFn } from '#/lib/actions'

export default function QuickNoteForm({ onDone }: { onDone: () => void }) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createNoteFn({ data: { body } })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
        <StickyNote size={14} aria-hidden="true" /> New note
      </p>
      <textarea
        autoFocus
        rows={3}
        placeholder="Write a note…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="field mb-2 resize-none"
      />
      {error && <p className="mb-2 text-[12px] font-semibold text-[var(--danger)]">{error}</p>}
      <button type="submit" disabled={saving || !body.trim()} className="btn btn-primary btn-square w-full">
        {saving ? 'Saving…' : 'Save note'}
      </button>
    </form>
  )
}
```

- [ ] **Step 1: Add a `categorySuggestions` prop, a category input, and thread it through submit**

Replace the whole file with:

```typescript
import { useState } from 'react'
import { StickyNote } from 'lucide-react'
import { createNoteFn } from '#/lib/actions'

export default function QuickNoteForm({
  onDone,
  categorySuggestions,
}: {
  onDone: () => void
  categorySuggestions: string[]
}) {
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createNoteFn({ data: { body, category: category.trim() || undefined } })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
        <StickyNote size={14} aria-hidden="true" /> New note
      </p>
      <textarea
        autoFocus
        rows={3}
        placeholder="Write a note…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="field mb-2 resize-none"
      />
      <input
        list="note-categories"
        placeholder="Category (optional)"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="field mb-2"
      />
      <datalist id="note-categories">
        {categorySuggestions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {error && <p className="mb-2 text-[12px] font-semibold text-[var(--danger)]">{error}</p>}
      <button type="submit" disabled={saving || !body.trim()} className="btn btn-primary btn-square w-full">
        {saving ? 'Saving…' : 'Save note'}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: A new error at `src/routes/home.tsx` where `<QuickNoteForm onDone=...>`
is rendered without the now-required `categorySuggestions` prop. This is
expected — Task 6 fixes it. Confirm the error is exactly that (missing prop),
not something else.

- [ ] **Step 3: Commit**

```bash
git add src/components/QuickNoteForm.tsx
git commit -m "feat: add category field to QuickNoteForm"
```

---

### Task 6: `NoteDetail` modal component

**Files:**
- Create: `src/components/NoteDetail.tsx`

This reuses the modal chrome pattern already established in
`src/components/ProjectEdit.tsx` (fixed inset-0 overlay + centered rounded
card + `display-title` header + circular X close button).

- [ ] **Step 1: Create the component**

```typescript
import { useState } from 'react'
import { X } from 'lucide-react'
import { updateNoteFn } from '#/lib/actions'

type Note = { id: string; body: string; category: string | null }

export default function NoteDetail({
  note,
  categorySuggestions,
  onClose,
  onSaved,
  onDelete,
}: {
  note: Note
  categorySuggestions: string[]
  onClose: () => void
  onSaved: () => void
  onDelete: () => void
}) {
  const [body, setBody] = useState(note.body)
  const [category, setCategory] = useState(note.category ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!body.trim()) return
    setSaving(true)
    setError(null)
    try {
      await updateNoteFn({ data: { id: note.id, body: body.trim(), category: category.trim() || undefined } })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(16,28,22,0.42)] px-5 py-10 backdrop-blur-[3px] gt-back"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[520px] overflow-hidden rounded-[24px] bg-[var(--card)] p-6 shadow-[0_30px_80px_-20px_rgba(16,28,22,0.5)] gt-pop">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="display-title text-2xl font-extrabold text-[var(--ink)]">Note</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] hover:text-[var(--ink)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <textarea
            autoFocus
            rows={10}
            placeholder="Write a note…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="field resize-none"
          />
          <div>
            <input
              list="note-detail-categories"
              placeholder="Category (optional)"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="field"
            />
            <datalist id="note-detail-categories">
              {categorySuggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          {error && <p className="text-[13px] font-semibold text-[var(--danger)]">{error}</p>}

          <div className="flex items-center justify-between">
            <button type="button" onClick={onDelete} className="btn btn-danger btn-square">
              Delete
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost btn-square">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !body.trim()}
                className="btn btn-primary btn-square"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: No new errors from this file (the pre-existing `home.tsx` prop
errors from Task 5 are still expected until Task 7).

- [ ] **Step 3: Commit**

```bash
git add src/components/NoteDetail.tsx
git commit -m "feat: add NoteDetail modal for viewing/editing a note"
```

---

### Task 7: Wire sort dropdown, category chip, and the modal into `/home`

**Files:**
- Modify: `src/routes/home.tsx`

- [ ] **Step 1: Add `useMemo` to the React import**

Change:

```typescript
import { useEffect, useRef, useState } from 'react'
```

to:

```typescript
import { useEffect, useMemo, useRef, useState } from 'react'
```

- [ ] **Step 2: Import `NoteDetail`**

Add near the other component imports (after `import QuickTaskForm from '#/components/QuickTaskForm'`):

```typescript
import NoteDetail from '#/components/NoteDetail'
```

- [ ] **Step 3: Add sort + selected-note state, category suggestions, and sorted list inside `PixelHome`**

Right after the existing `removeNote` function in `PixelHome` (currently at
`src/routes/home.tsx:327-331`):

```typescript
  async function removeNote(id: string) {
    if (!window.confirm('Delete this note?')) return
    await deleteNoteFn({ data: { id } })
    router.invalidate()
  }
```

add:

```typescript
  const [noteSort, setNoteSort] = useState<'newest' | 'oldest' | 'category'>('newest')
  const [selectedNote, setSelectedNote] = useState<DashboardData['notes'][number] | null>(null)

  const noteCategories = useMemo(
    () => Array.from(new Set(d.notes.map((n) => n.category).filter((c): c is string => !!c))).sort(),
    [d.notes],
  )

  const sortedNotes = useMemo(() => {
    const arr = [...d.notes]
    if (noteSort === 'oldest') arr.sort((a, b) => a.created_at.localeCompare(b.created_at))
    else if (noteSort === 'category')
      arr.sort(
        (a, b) => (a.category ?? '').localeCompare(b.category ?? '') || b.created_at.localeCompare(a.created_at),
      )
    else arr.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return arr
  }, [d.notes, noteSort])
```

- [ ] **Step 3b: Fix the OTHER `QuickNoteForm` call site (Quick Actions tile)**

`QuickNoteForm` is rendered in two places, not one — the Notes section (fixed in
Step 4 below) AND the "Add Note" tile in the Quick Actions grid
(`src/routes/home.tsx`, inside the `⚡ Quick Actions` section, around where
`QuickTile label="Add Note"` is defined):

```typescript
              <QuickTile
                label="Add Note"
                icon={StickyNote}
                tint="#7c3aed"
                panel={(close) => (
                  <QuickNoteForm
                    onDone={() => {
                      close()
                      router.invalidate()
                    }}
                  />
                )}
              />
```

Add the same `categorySuggestions={noteCategories}` prop here too:

```typescript
              <QuickTile
                label="Add Note"
                icon={StickyNote}
                tint="#7c3aed"
                panel={(close) => (
                  <QuickNoteForm
                    categorySuggestions={noteCategories}
                    onDone={() => {
                      close()
                      router.invalidate()
                    }}
                  />
                )}
              />
```

- [ ] **Step 4: Add the sort `<select>` next to "+ New Note"**

Find the Notes section header (`src/routes/home.tsx:602-628`):

```typescript
          {/* NOTES */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                📝 Notes
              </h3>
              <Popover
                align="left"
                panelClassName="w-64"
                renderTrigger={(_open, toggle) => (
                  <button
                    type="button"
                    onClick={toggle}
                    className="flex items-center gap-1 text-[11px] font-bold text-[var(--accent-ink)] hover:underline"
                  >
                    <Plus size={12} /> New Note
                  </button>
                )}
                renderPanel={(close) => (
                  <QuickNoteForm
                    onDone={() => {
                      close()
                      router.invalidate()
                    }}
                  />
                )}
              />
            </div>
```

Replace with:

```typescript
          {/* NOTES */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                📝 Notes
              </h3>
              <div className="flex items-center gap-3">
                <select
                  value={noteSort}
                  onChange={(e) => setNoteSort(e.target.value as typeof noteSort)}
                  aria-label="Sort notes"
                  className="field w-auto"
                  style={{ padding: '0.3rem 0.5rem', fontSize: '11px' }}
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="category">Category (A–Z)</option>
                </select>
                <Popover
                  align="left"
                  panelClassName="w-64"
                  renderTrigger={(_open, toggle) => (
                    <button
                      type="button"
                      onClick={toggle}
                      className="flex items-center gap-1 text-[11px] font-bold text-[var(--accent-ink)] hover:underline"
                    >
                      <Plus size={12} /> New Note
                    </button>
                  )}
                  renderPanel={(close) => (
                    <QuickNoteForm
                      categorySuggestions={noteCategories}
                      onDone={() => {
                        close()
                        router.invalidate()
                      }}
                    />
                  )}
                />
              </div>
            </div>
```

- [ ] **Step 5: Make each note card clickable, show its category chip, and sort from `sortedNotes`**

Find the notes list rendering (`src/routes/home.tsx:630-648`):

```typescript
            <div className="flex flex-col gap-2">
              {d.notes.length === 0 && <p className="text-[12px] text-[var(--ink3)]">No notes.</p>}
              {d.notes.map((n) => (
                <div
                  key={n.id}
                  className="flex items-start gap-2 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--pop-soft)] p-2.5"
                >
                  <p className="min-w-0 flex-1 text-[12px] font-semibold text-[var(--pop-ink)]">{n.body}</p>
                  <button
                    type="button"
                    onClick={() => removeNote(n.id)}
                    aria-label="Delete note"
                    className="shrink-0 text-[var(--pop-ink)] hover:text-[var(--danger)]"
                  >
                    <MoreVertical size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>
```

Replace with:

```typescript
            <div className="flex flex-col gap-2">
              {sortedNotes.length === 0 && <p className="text-[12px] text-[var(--ink3)]">No notes.</p>}
              {sortedNotes.map((n) => (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedNote(n)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedNote(n)}
                  className="flex cursor-pointer items-start gap-2 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--pop-soft)] p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-[var(--pop-ink)]">{n.body}</p>
                    {n.category && (
                      <span className="chip mt-1 inline-flex">{n.category}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeNote(n.id)
                    }}
                    aria-label="Delete note"
                    className="shrink-0 text-[var(--pop-ink)] hover:text-[var(--danger)]"
                  >
                    <MoreVertical size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {selectedNote && (
            <NoteDetail
              note={selectedNote}
              categorySuggestions={noteCategories}
              onClose={() => setSelectedNote(null)}
              onSaved={() => {
                setSelectedNote(null)
                router.invalidate()
              }}
              onDelete={async () => {
                await removeNote(selectedNote.id)
                setSelectedNote(null)
              }}
            />
          )}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: No errors found

- [ ] **Step 7: Commit**

```bash
git add src/routes/home.tsx
git commit -m "feat: wire note sort dropdown, category chip, and detail modal"
```

---

### Task 8: Manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev preview**

Use the project's dev server (`.claude/launch.json` → `dev`, port 4321 with
`autoPort` fallback) and open `/home`.

- [ ] **Step 2: Create a tagged note**

Click "+ New Note", enter a body and a category (e.g. "Ideas"), save. Confirm
it appears in the list with a chip showing "Ideas".

- [ ] **Step 3: Open, edit, and save via the modal**

Click the note body (not the kebab). Confirm the modal opens with the full
body and category pre-filled. Change the body to something longer (a few
sentences) and change the category. Click Save. Confirm the modal closes and
the card reflects the new body/chip.

- [ ] **Step 4: Sort**

Add a second note with a different category. Switch the sort dropdown between
Newest / Oldest / Category (A–Z) and confirm the list order changes
accordingly.

- [ ] **Step 5: Delete from inside the modal**

Open a note, click Delete inside the modal, confirm the browser `confirm()`
dialog, confirm the note disappears from the list and the modal closes.

- [ ] **Step 6: Delete via the kebab (regression check)**

Confirm the existing kebab "⋮" quick-delete on a card still works without
opening the modal (click should not trigger `setSelectedNote`).

---

## Self-Review Notes

- **Spec coverage:** category column (Task 1) · createNote/updateNote (Task 2)
  · server actions (Task 3) · dashboard select/limit/type (Task 4) ·
  QuickNoteForm category field (Task 5) · NoteDetail modal (Task 6) · sort
  dropdown + chip + wiring (Task 7) · manual UI verification (Task 8). All
  spec sections have a task.
- **Type consistency:** `Note`/`DashboardData['notes'][number]` shape
  `{ id, body, category, created_at }` used identically across
  `dashboard.ts`, `NoteDetail.tsx`, and `home.tsx`. `updateNoteFn`/`createNoteFn`
  both accept `{ body, category }` with the same trim-to-null-or-string
  convention.
- **Manual DB step:** called out explicitly before Task 2 so whoever executes
  this plan doesn't burn cycles debugging a schema error that isn't a code bug.
