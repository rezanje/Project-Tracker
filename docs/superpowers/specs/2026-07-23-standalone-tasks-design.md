# Standalone (no-project) tasks

## Problem

Every task today is a `card`, which requires a `column_id` -> `board`. There's no way
to jot down a task that isn't tied to a project — user wants a place to note things
like "renew domain" or "call accountant" without creating a throwaway board for it.

## Approach

New table `standalone_tasks`, fully decoupled from `boards`/`columns`/`cards`. No
project/board reference at all. Owner-only via RLS. Minimal fields: title + due date;
assignee is implicitly the creator (no board members to assign to).

Surfaced in two places:
- **Create**: `QuickTaskForm.tsx` gets an extra board-picker option, "No project
  (personal note)". Picking it hides workspace/board/assignee pickers and submits to
  a new server fn instead of `quickCreateTaskFn`.
- **View**: `my-tasks.tsx` merges `standalone_tasks` into the same due-date buckets
  as board tasks. Each row shows a checkbox to mark done (removes it) instead of a
  link to a board, since there's nothing to navigate to.

Marking done is the only "completion" affordance — no separate delete, no edit-after-
create. If the title/date was wrong, mark done and re-add.

## Changes

1. **Migration `0032_standalone_tasks.sql`**
   ```sql
   create table standalone_tasks (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references profiles on delete cascade,
     title text not null,
     due_date date,
     done boolean not null default false,
     created_at timestamptz default now()
   );

   alter table standalone_tasks enable row level security;

   create policy "own standalone tasks" on standalone_tasks
     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
   ```

2. **`src/lib/actions.ts`**
   - New `createStandaloneTaskFn` (POST), mirrors `createNoteFn`'s validator shape:
     validates `title` (required, trimmed) and `dueDate` (optional string or null).
     Inserts into `standalone_tasks` with `user_id = user.id`.
   - New `completeStandaloneTaskFn` (POST), validates `id`, updates
     `done = true` scoped to `user_id = user.id` (RLS covers this but the `.eq`
     keeps the query intent-revealing).

3. **`src/components/QuickTaskForm.tsx`**
   - Board `<select>` gets a leading option `value="__none__"` labeled
     "No project (personal note)".
   - When `boardId === '__none__'`: skip the workspace/board-scoped assignee fetch
     (`fetchBoardAssigneesFn` effect), hide the assignee `<select>`, hide the
     workspace `<select>` (board is meaningless here).
   - `submit()` branches: if `__none__`, call `createStandaloneTaskFn({title, dueDate})`
     then just `onDone()` (no `navigate`, no board to land on). Needs a due-date
     `<input type="date">` added to the form — doesn't exist today since board tasks
     get their due date set later via the card detail view.
   - Default `boardId` init logic (currently picks the first board in scope) leaves
     `__none__` as a selectable option, not the default — default stays "first real
     board" so existing behavior/muscle-memory is unchanged.

4. **`src/routes/my-tasks.tsx`**
   - `Task` type: `boardId` becomes `string | null`; add `standalone?: boolean`.
   - `fetchMyTasks` also queries `standalone_tasks` where `user_id = user.id and done = false`,
     maps to `{ id, title, boardId: null, boardTitle: 'Personal', colTitle: '', due: due_date, standalone: true }`.
   - Row render: when `t.standalone`, render a `<button>` (checkbox icon) that calls
     a new client-side `completeStandaloneTaskFn` call and optimistically removes the
     row from local state, instead of the `<Link to="/board/$boardId">`.

## Out of scope

- No description, comments, attachments, labels, or assignee-to-others on standalone
  tasks — title + due date only, matches the approved design.
- No edit-in-place — done is the only state transition exposed in the UI (row can
  still be updated directly via the DB if ever needed later).
- No migration/backfill of existing data — this is a wholly new, empty table.
- Not shown anywhere except `my-tasks.tsx` (no board, no command center widget, no
  home dashboard integration) — out of scope for this pass.

## Testing

- Typecheck (`npx tsc --noEmit -p .`) after the type/field changes.
- Manual: open "+ New" quick task, pick "No project", set title + due date, submit —
  confirm it appears in My Tasks under the right due-date bucket tagged "Personal".
  Check the box, confirm it disappears. Confirm normal board-task quick-create still
  works unchanged (default board selection, navigate-to-board behavior intact).
