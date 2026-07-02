# Enhanced Task Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board a real task manager — new projects seed default phases, tasks are created via a full-field modal, tasks carry a category, and the board can be grouped and filtered by category; the project's description shows atop the board.

**Architecture:** A migration adds `cards.category` and seeds default columns on board create. Card create/update paths gain the extra fields. Board rendering derives grouped/filtered views client-side from already-loaded data. New modal `TaskCreate.tsx`; small pure helpers in `board-data.ts` are unit-tested.

**Tech Stack:** TanStack Start/Router, React 19, Supabase (RLS), Tailwind v4, Vitest, dnd-kit.

## Global Constraints

- Package manager is **npm** (`npx vitest run`, `npx tsc --noEmit`).
- DB reads/writes go through the RLS-scoped client from `requireUser(getRequest(), headers)`; call `flush(headers)` before returning from a server fn.
- Category is one free-text value per card; colour derived from the string (reuse a hash like `accentFor`), never a hardcoded map.
- Phase = a `columns` row. Group-by-Category is a **read-only view**: drag-and-drop is enabled only in Phase mode.
- Migration `0010` is applied by the user against remote Supabase; code must not assume it ran until this plan's Task 1 is merged.
- Reuse existing tokens/classes and the modal shell pattern from `CardDetail.tsx` (`fixed inset-0 z-50 … gt-back` backdrop + `gt-pop` panel).

---

### Task 1: Migration, `category` on CardRow, grouping helpers (TDD)

**Files:**
- Create: `supabase/migrations/0010_task_category_and_default_phases.sql`
- Modify: `src/lib/board-data.ts` (add `category` to `CardRow`, to `loadBoard`'s card select, add two pure helpers)
- Test: `src/lib/board-data.test.ts` (append)

**Interfaces:**
- Produces:
  - `CardRow` gains `category: string | null`
  - `distinctCategories(cards: { category: string | null }[]): string[]`
  - `groupByCategory(cards: CardRow[]): { category: string; cards: CardRow[] }[]`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0010_task_category_and_default_phases.sql`:

```sql
alter table cards add column category text;

-- Seed default phases on every new board so it's usable immediately.
create or replace function add_owner_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.board_members (board_id, user_id, role)
    values (new.id, new.owner_id, 'owner');
  insert into public.columns (board_id, title, position) values
    (new.id, 'Backlog', 0), (new.id, 'In Progress', 1), (new.id, 'Done', 2);
  return new;
end $$;
```

- [ ] **Step 2: Write the failing test**

Append to `src/lib/board-data.test.ts`:

```ts
import { distinctCategories, groupByCategory } from './board-data'

test('distinctCategories returns sorted unique non-null categories', () => {
  const cards = [
    { category: 'Design' }, { category: null }, { category: 'Dev' }, { category: 'Design' },
  ]
  expect(distinctCategories(cards)).toEqual(['Design', 'Dev'])
})

test('groupByCategory buckets by category with an Uncategorised bucket', () => {
  const mk = (id: string, category: string | null) =>
    ({ id, title: id, description: null, due_date: null, assignee_id: null, category, position: 0, card_labels: [] })
  const groups = groupByCategory([mk('a', 'Design'), mk('b', null), mk('c', 'Design')])
  expect(groups.find((g) => g.category === 'Design')!.cards.map((c) => c.id)).toEqual(['a', 'c'])
  expect(groups.find((g) => g.category === 'Uncategorised')!.cards.map((c) => c.id)).toEqual(['b'])
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/board-data.test.ts`
Expected: FAIL — `distinctCategories`/`groupByCategory` not exported.

- [ ] **Step 4: Implement**

In `src/lib/board-data.ts`, add `category: string | null` to `CardRow`:

```ts
export type CardRow = {
  id: string
  title: string
  description: string | null
  due_date: string | null
  assignee_id: string | null
  category: string | null
  position: number
  card_labels: { label_id: string }[]
}
```

Add `category` to the card select inside `loadBoard` (the `.from('columns').select(...)` string):

```ts
'id,title,position,cards(id,title,description,due_date,assignee_id,category,position,card_labels(label_id))',
```

Append the helpers at the end of the file:

```ts
/** Sorted, unique, non-empty category names across the given cards. */
export function distinctCategories(cards: { category: string | null }[]): string[] {
  const set = new Set<string>()
  for (const c of cards) if (c.category) set.add(c.category)
  return [...set].sort()
}

/** Bucket cards by category; null/empty categories fall into "Uncategorised". */
export function groupByCategory(cards: CardRow[]): { category: string; cards: CardRow[] }[] {
  const map = new Map<string, CardRow[]>()
  for (const c of cards) {
    const key = c.category ?? 'Uncategorised'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(c)
  }
  return [...map.entries()].map(([category, cards]) => ({ category, cards }))
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run src/lib/board-data.test.ts && npx tsc --noEmit`
Expected: tests PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0010_task_category_and_default_phases.sql src/lib/board-data.ts src/lib/board-data.test.ts
git commit -m "feat: card category + default-phase seed migration + grouping helpers"
```

---

### Task 2: Extend createCard, category in card + detail

**Files:**
- Modify: `src/lib/cards.ts` (`createCard` accepts extra fields; `updateCard` accepts `category`)
- Modify: `src/components/Card.tsx` (render category label)
- Modify: `src/components/CardDetail.tsx` (category field, saved via `onUpdateCard`)
- Modify: `src/routes/board.$boardId.tsx` (`updateCardFn` validator: allow `category`)

**Interfaces:**
- Consumes: `CardRow.category` (Task 1).
- Produces:
  - `createCard(supabase, columnId, title, extra?: { description?: string | null; due_date?: string | null; assignee_id?: string | null; category?: string | null }): Promise<CardRow>`
  - `catColor(s: string): string` exported from `src/components/Card.tsx`

- [ ] **Step 1: Extend `createCard` and `updateCard`**

In `src/lib/cards.ts`, change `updateCard`'s field type to include category:

```ts
  fields: Partial<{ title: string; description: string | null; due_date: string | null; assignee_id: string | null; category: string | null }>,
```

Replace `createCard` with:

```ts
export async function createCard(
  supabase: SupabaseClient,
  columnId: string,
  title: string,
  extra: {
    description?: string | null
    due_date?: string | null
    assignee_id?: string | null
    category?: string | null
  } = {},
): Promise<CardRow> {
  const { data: last } = await supabase
    .from('cards')
    .select('position')
    .eq('column_id', columnId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPosition = last ? last.position + 1 : 0

  const { data, error } = await supabase
    .from('cards')
    .insert({ column_id: columnId, title, position: nextPosition, ...extra })
    .select('id,title,description,due_date,assignee_id,category,position,card_labels(label_id)')
    .single()

  if (error) throw error
  return data as CardRow
}
```

- [ ] **Step 2: Allow `category` in `updateCardFn` validator**

In `src/routes/board.$boardId.tsx`, inside `updateCardFn`'s `.validator`, add to the built `fields` object (next to the `due_date`/`assignee_id` spreads):

```ts
        ...(typeof f.category === 'string' || f.category === null
          ? { category: f.category as string | null }
          : {}),
```

- [ ] **Step 3: Render category label on the card**

In `src/components/Card.tsx`, add a colour helper below the imports:

```ts
const CAT_COLORS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']
export function catColor(s: string): string {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return CAT_COLORS[h % CAT_COLORS.length]
}
```

Insert the category label just after the title `<p>` (before the description block):

```tsx
      {card.category && (
        <span
          className="mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={{ background: `${catColor(card.category)}22`, color: catColor(card.category) }}
        >
          {card.category}
        </span>
      )}
```

- [ ] **Step 4: Add category field to CardDetail**

In `src/components/CardDetail.tsx`: add state near the other fields (after `assigneeId`):

```tsx
  const [category, setCategory] = useState(card.category ?? '')
```

Include it in the `handleSave` `onUpdateCard` call (add the key to the fields object):

```tsx
        category: category.trim() || null,
```

Add a `categorySuggestions?: string[]` prop to `CardDetailProps` and the destructure (default `[]`), then render a field in the owner form (place it right before the Save/Cancel `div`):

```tsx
          {isOwner && (
            <div className="mb-4">
              <label className={fieldLabel}>Category</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="card-categories"
                placeholder="Design, Bug…"
                className="field"
              />
              <datalist id="card-categories">
                {categorySuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          )}
```

Pass `categorySuggestions` where `<CardDetail>` is rendered in `board.$boardId.tsx` (compute from the board's cards):

```tsx
          categorySuggestions={distinctCategories(columns.flatMap((c) => c.cards))}
```

Add the import in `board.$boardId.tsx`: `distinctCategories` from `#/lib/board-data`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cards.ts src/components/Card.tsx src/components/CardDetail.tsx src/routes/board.$boardId.tsx
git commit -m "feat: card category field (create/detail/label)"
```

---

### Task 3: TaskCreate modal + Add task button

**Files:**
- Create: `src/components/TaskCreate.tsx`
- Modify: `src/routes/board.$boardId.tsx` (`addTaskFn` server fn, Add task button, modal wiring)

**Interfaces:**
- Consumes: `createCard` extended (Task 2), `distinctCategories` (Task 1), `BoardMeta` members, `catColor` (Task 2).
- Produces: `addTaskFn` server fn (POST) `{ columnId, title, due_date, assignee_id, category, description }`.

- [ ] **Step 1: Add `addTaskFn` server fn**

In `src/routes/board.$boardId.tsx`, after `deleteCardFn`, add:

```ts
const addTaskFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const f = (d ?? {}) as Record<string, unknown>
    if (typeof f.columnId !== 'string' || typeof f.title !== 'string' || !f.title.trim())
      throw new Error('columnId and title required')
    const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return {
      columnId: f.columnId,
      title: f.title.trim(),
      due_date: s(f.due_date),
      assignee_id: s(f.assignee_id),
      category: s(f.category),
      description: s(f.description),
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const { columnId, title, ...extra } = data
    await createCard(supabase, columnId, title, extra)
    flush(headers)
  })
```

- [ ] **Step 2: Create `TaskCreate.tsx`**

```tsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { catColor } from '#/components/Card'
import type { BoardMeta } from '#/routes/board.$boardId'

interface Props {
  columns: { id: string; title: string }[]
  members: BoardMeta['members']
  categorySuggestions: string[]
  onClose: () => void
  onCreated: () => void
  onCreate: (task: {
    columnId: string
    title: string
    due_date: string | null
    assignee_id: string | null
    category: string | null
    description: string | null
  }) => Promise<void>
}

const label = 'mb-1.5 text-xs font-bold uppercase tracking-[0.04em] text-[var(--ink3)]'

export default function TaskCreate({ columns, members, categorySuggestions, onClose, onCreated, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [columnId, setColumnId] = useState(columns[0]?.id ?? '')
  const [dueDate, setDueDate] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!title.trim() || !columnId) {
      setError('Name and phase are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        columnId,
        title: title.trim(),
        due_date: dueDate || null,
        assignee_id: assigneeId || null,
        category: category.trim() || null,
        description: description.trim() || null,
      })
      onCreated()
    } catch {
      setError('Failed to create task. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(16,28,22,0.42)] px-5 py-10 backdrop-blur-[3px] gt-back"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-[24px] bg-[var(--card)] p-6 shadow-[0_30px_80px_-20px_rgba(16,28,22,0.5)] gt-pop">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="display-title text-2xl font-extrabold text-[var(--ink)]">Add task</h2>
          <button onClick={onClose} aria-label="Close" className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] hover:text-[var(--ink)]">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <div className={label}>Task name</div>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="field" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className={label}>Phase</div>
              <select value={columnId} onChange={(e) => setColumnId(e.target.value)} className="field">
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
            <div>
              <div className={label}>Due date</div>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="field" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className={label}>Assignee</div>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="field">
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div className={label}>Category</div>
              <input value={category} onChange={(e) => setCategory(e.target.value)} list="task-categories" placeholder="Design, Bug…" className="field" />
              <datalist id="task-categories">
                {categorySuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {category.trim() && (
                <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `${catColor(category.trim())}22`, color: catColor(category.trim()) }}>
                  {category.trim()}
                </span>
              )}
            </div>
          </div>
          <div>
            <div className={label}>Description</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="field min-h-[80px] resize-y leading-relaxed" />
          </div>
          {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
          <div className="flex gap-2.5">
            <button onClick={handleCreate} disabled={busy} className="btn btn-primary btn-square">
              {busy ? 'Adding…' : 'Add task'}
            </button>
            <button onClick={onClose} className="btn btn-ghost btn-square">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire the button + modal in the board**

In `src/routes/board.$boardId.tsx`: import `TaskCreate from '#/components/TaskCreate'`. Add state near `editing`:

```tsx
  const [addingTask, setAddingTask] = useState(false)
```

Add an `+ Add task` button in the owner header block (right after the `Edit project` button):

```tsx
            <button type="button" onClick={() => setAddingTask(true)} className="btn btn-primary shrink-0">
              + Add task
            </button>
```

Render the modal next to the `ProjectEdit` render:

```tsx
      {addingTask && (
        <TaskCreate
          columns={columns.map((c) => ({ id: c.id, title: c.title }))}
          members={(boardMeta ?? { members: [], labels: [] }).members}
          categorySuggestions={distinctCategories(columns.flatMap((c) => c.cards))}
          onClose={() => setAddingTask(false)}
          onCreated={() => {
            setAddingTask(false)
            router.invalidate()
          }}
          onCreate={(t) => addTaskFn({ data: t })}
        />
      )}
```

Note: `boardMeta` is loaded lazily on card open. So members may be empty when the modal opens first. In `BoardView`, also load it on mount — change the existing `useEffect(() => { setColumns(initialBoard.columns) }, [initialBoard])` region by adding a second effect:

```tsx
  useEffect(() => {
    if (!boardMeta) fetchBoardMeta({ data: { boardId: initialBoard.id } }).then(setBoardMeta)
  }, [initialBoard.id, boardMeta])
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/TaskCreate.tsx src/routes/board.$boardId.tsx
git commit -m "feat: Add task modal with all fields"
```

---

### Task 4: Filter + Group-by toolbar

**Files:**
- Modify: `src/routes/board.$boardId.tsx` (toolbar state + render; grouped/filtered board)

**Interfaces:**
- Consumes: `groupByCategory`, `distinctCategories` (Task 1); `ColumnRow` (existing).

- [ ] **Step 1: Add toolbar state + derived view**

In `BoardView`, add state near `addingTask`:

```tsx
  const [groupBy, setGroupBy] = useState<'phase' | 'category'>('phase')
  const [filterCat, setFilterCat] = useState<string>('')
```

Add imports: `groupByCategory` (already importing `distinctCategories`).

Compute the filtered columns and the categorised view above the `return`:

```tsx
  const allCards = columns.flatMap((c) => c.cards)
  const categories = distinctCategories(allCards)
  const keep = (card: CardRow) => !filterCat || card.category === filterCat
  const phaseColumns: ColumnRow[] = columns.map((c) => ({ ...c, cards: c.cards.filter(keep) }))
  const categoryColumns = groupByCategory(allCards.filter(keep)).map((g) => ({
    id: `cat:${g.category}`,
    title: g.category,
    position: 0,
    cards: g.cards,
  }))
```

- [ ] **Step 2: Render the toolbar**

Insert directly above the columns container (the element that maps `columns` into `<Column>`), a toolbar:

```tsx
        <div className="mb-4 flex flex-wrap items-center gap-3 px-1">
          <span className="text-[13px] font-semibold text-[var(--ink3)]">Group by</span>
          <div className="flex overflow-hidden rounded-full border border-[var(--line)]">
            {(['phase', 'category'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroupBy(g)}
                className={`px-3 py-1.5 text-[13px] font-bold capitalize ${groupBy === g ? 'bg-[var(--btn)] text-white' : 'text-[var(--ink2)]'}`}
              >
                {g}
              </button>
            ))}
          </div>
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            className="field w-auto rounded-full px-3 py-1.5 text-[13px]"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
```

- [ ] **Step 3: Switch the rendered columns by mode**

Where the board currently renders `columns.map((col) => <Column .../>)` inside the DnD context: render `phaseColumns` in phase mode (drag enabled), and in category mode render the `categoryColumns` as **non-owner** (read-only, drag disabled) Columns without `onAddCard`. Concretely, replace the columns render with:

```tsx
        {groupBy === 'phase'
          ? phaseColumns.map((col) => (
              <Column key={col.id} column={col} isOwner={isOwner} onAddCard={onAddCard} onCardClick={openCardDetail} />
            ))
          : categoryColumns.map((col) => (
              <Column key={col.id} column={col} isOwner={false} onCardClick={openCardDetail} />
            ))}
```

Keep the surrounding `<DndContext>`/`<SortableContext>` wiring for phase mode as-is; in category mode the cards are non-draggable because `isOwner={false}` disables the sortable. (The DndContext may stay mounted; with no draggable cards it is inert.)

- [ ] **Step 4: Typecheck + manual check**

Run: `npx tsc --noEmit`
Expected: clean. Manual: toggle Group by → Category regroups; filter narrows cards; Phase mode still drags.

- [ ] **Step 5: Commit**

```bash
git add src/routes/board.$boardId.tsx
git commit -m "feat: group-by-category + category filter toolbar"
```

---

### Task 5: Project description in board header

**Files:**
- Modify: `src/routes/board.$boardId.tsx` (render `board.description`)

- [ ] **Step 1: Render the description**

In the header left column, right after the metadata badge row's closing `</div>`, add:

```tsx
          {board.description && (
            <p className="mt-2.5 max-w-[640px] text-[14px] leading-relaxed text-[var(--ink2)]">
              {board.description}
            </p>
          )}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/routes/board.$boardId.tsx
git commit -m "feat: show project description in board header"
```

---

## Self-Review

- **Spec coverage:** migration + category column → T1; default phases → T1 migration; project description header → T5; add-task modal all fields → T3; category on card + detail → T2; filter + group toggle → T4; drag only in phase mode → T4 (category columns `isOwner={false}`); grouping helper + test → T1. All spec sections mapped.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `CardRow.category` defined T1, used T2/T3/T4; `createCard(…, extra?)` defined T2, consumed T3; `catColor` exported from `Card.tsx` T2, imported by `TaskCreate` T3; `distinctCategories`/`groupByCategory` defined T1, used T2/T3/T4; `addTaskFn` payload matches `TaskCreate.onCreate` shape.
- **Migration gate:** Task 1 ships the migration file; the user must run it (SQL editor) before the category/phase features work at runtime. Implementer note: `npx tsc` and unit tests pass without the migration, but manual board checks require it applied.
- **Risk note:** `BoardMeta` members load lazily; Task 3 Step 3 adds a mount effect so the Add-task assignee list is populated. Confirm no duplicate fetch loop (guarded by `!boardMeta`).
