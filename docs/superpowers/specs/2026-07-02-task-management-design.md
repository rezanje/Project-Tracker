# Enhanced Task Management

**Date:** 2026-07-02
**Routes/files:** `src/routes/board.$boardId.tsx`, `src/components/Column.tsx`,
`src/components/CardDetail.tsx`, new `src/components/TaskCreate.tsx`,
`src/lib/cards.ts`, `src/lib/board-data.ts`, migration `0010`.

## Goal

Make the board a usable task manager: every new project starts with phases so
tasks can be added immediately; tasks are created through a full-field modal;
tasks carry a category; and the board can be grouped and filtered by category.
The project's full details (including description) show at the top of the board.

## Migration `0010_task_category_and_default_phases.sql`

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

Existing boards keep their columns; only new boards get the seeded phases.
Applied by the user against the remote Supabase project (SQL editor).

## Data

- **Phase** = a `columns` row (existing kanban column). Creating a task picks
  which column it lands in. No new field.
- **Category** = new free-text `cards.category` column. Rendered as a coloured
  label; colour derived deterministically from the string (same hash as
  `accentFor`), so new categories "just work". One category per card.

`CardRow` (board-data.ts) gains `category: string | null`. `loadBoard`'s card
select adds `category`.

## Components & flow

### 1. Project details header (`board.$boardId.tsx`)
Below the existing badge row, render the project **description** (if set) as a
paragraph. The badge row already shows type/status/client/deadline/PIC/value.

### 2. Add task (`TaskCreate.tsx`, new)
A `+ Add task` button in the board header (owner only) opens a modal with:
name (title), **phase** (`<select>` of the board's columns), due date,
**assignee** (`<select>` of board members), **category** (text + `<datalist>`
of existing categories, coloured preview), description.

On save it calls a new server fn `addTaskFn` → `createCard`, extended to accept
all fields. The per-column quick `Add a card…` input stays (title-only fast path).

`createCard(supabase, columnId, title, extra?)` where
`extra?: { description?; due_date?; assignee_id?; category? }`. It still does
`insert(...).select(...).single()` — safe here because the card's board SELECT
policy (`is_board_member`) is already satisfied (the owner is a member before
the insert), unlike the boards RETURNING case.

### 3. Category on card + detail
- `Column.tsx` card: show the category as a small coloured label (next to any
  existing labels).
- `CardDetail.tsx`: add a category field (text + datalist), saved via the
  existing `onUpdateCard` path — extend its field set with `category`.

### 4. Filter + Group by toolbar (`board.$boardId.tsx`)
A toolbar above the columns:
- **Group by: Phase | Category** — client-side state.
  - *Phase* (default): current columns; full drag-and-drop.
  - *Category*: cards re-bucketed by `category` (distinct values + an
    "Uncategorised" bucket). **Read-only view — drag-and-drop is disabled in
    this mode** (dragging across category buckets is out of scope; upgrade path
    is to have a cross-bucket drop set `card.category`).
- **Filter: All | <category>** — dropdown of distinct categories; when set,
  only matching cards render, in either grouping mode.

Both are derived client-side from the already-loaded board data; no refetch.

## Testing

- Unit test a pure `groupByCategory(cards)` / `distinctCategories(cards)` helper
  (extracted to `src/lib/board-data.ts` or a small module): asserts bucketing,
  the Uncategorised bucket, and distinct list ordering. Vitest, matching the
  existing `src/lib/*.test.ts` pattern.
- Manual: create a new project → it has 3 phases → Add task with all fields →
  card shows category label → group by Category → filter by a category.

## Out of scope (YAGNI)

Custom per-task fields, multiple categories per card, sub-tasks, drag-to-
recategorise, per-board custom phase templates beyond the seeded default.
