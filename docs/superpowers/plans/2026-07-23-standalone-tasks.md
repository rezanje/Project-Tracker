# Standalone (no-project) tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user jot down a task that isn't tied to any board/project, and see it alongside their board tasks in My Tasks.

**Architecture:** New `standalone_tasks` table, fully decoupled from `boards`/`columns`/`cards`, owner-scoped via RLS. A `src/lib/standalone-tasks.ts` module (mirrors `src/lib/notes.ts`) provides `createStandaloneTask`/`completeStandaloneTask`, wired into `src/lib/actions.ts` as two server fns. `QuickTaskForm.tsx` gets a "No project" board-picker option that routes to the new fn instead of `quickCreateTaskFn`. `my-tasks.tsx` merges standalone tasks into its existing due-date buckets, rendering them as a checkbox-to-complete row instead of a link-to-board row.

**Tech Stack:** TanStack Start server fns, Supabase (Postgres + RLS), React, Vitest (integration tests against the real remote DB via `.dev.vars`).

## Global Constraints

- Remote-only Supabase — no local Docker. Migrations are written as files here but
  **applied to the remote DB by the user** (dashboard SQL editor or `db push` with a
  pooler URL + DB password they hold). Never ask for or use the DB password.
- Tests hit the real remote DB (`npm test`) — the `standalone_tasks` table must exist
  on remote before Task 3's tests can pass.
- No ESLint config — `npx tsc --noEmit -p .` is the only automated code-quality gate.
- Follow the `notes`/`createNote`/`createNoteFn` pattern already in the codebase
  (`src/lib/notes.ts`, `src/lib/actions.ts`, `supabase/migrations/0013_announcements_notes.sql`)
  — same shape, same RLS style, same test style (`src/lib/notes.test.ts`).
- Simplification vs. the spec: the spec's `Task.standalone?: boolean` flag is dropped
  in favor of using `boardId === null` as the discriminator in `my-tasks.tsx` — a
  standalone task always has `boardId: null`, so a second flag would be redundant.
  Behavior is identical; this is a type-shape simplification only.

---

### Task 1: Migration — `standalone_tasks` table

**Files:**
- Create: `supabase/migrations/0032_standalone_tasks.sql`

**Interfaces:**
- Produces: table `standalone_tasks(id uuid, user_id uuid, title text, due_date date,
  done boolean, created_at timestamptz)`, RLS policy scoping all rows to
  `user_id = auth.uid()`. Task 3's `createStandaloneTask`/`completeStandaloneTask`
  read/write this table by exactly these column names.

- [ ] **Step 1: Write the migration file**

```sql
-- Personal, project-less tasks: private to their author, not attached to any
-- board/column/card. Surfaced in My Tasks alongside board tasks.
create table standalone_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  title text not null,
  due_date date,
  done boolean not null default false,
  created_at timestamptz default now()
);
alter table standalone_tasks enable row level security;
create policy standalone_tasks_own on standalone_tasks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Save as `supabase/migrations/0032_standalone_tasks.sql`.

- [ ] **Step 2: Apply the migration to the remote DB**

This step is **not automated** — per project convention (CLAUDE.md), migrations are
applied by the user, not by an agent holding the DB password. Ask the user to run
one of:

- Supabase Dashboard → SQL Editor → paste the contents of
  `supabase/migrations/0032_standalone_tasks.sql` → Run, then:
  ```bash
  npx supabase migration repair --status applied 0032 --db-url "<pooler-url>"
  ```
- Or: `npx supabase db push --db-url "<pooler-url>"` (pooler URL shape documented in
  CLAUDE.md, password is the user's own secret).

Do not proceed to Task 3 (which needs the live table for its tests) until the user
confirms this is applied. Task 2 (the `standalone-tasks.ts` module itself) can be
written in the meantime since it doesn't require a live DB to write or typecheck.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0032_standalone_tasks.sql
git commit -m "feat: add standalone_tasks table for project-less tasks"
```

---

### Task 2: `src/lib/standalone-tasks.ts` + tests

**Files:**
- Create: `src/lib/standalone-tasks.ts`
- Test: `src/lib/standalone-tasks.test.ts`

**Interfaces:**
- Consumes: `standalone_tasks` table from Task 1 (must be live on remote before
  running these tests).
- Produces: `createStandaloneTask(supabase, userId, title, dueDate?)`,
  `completeStandaloneTask(supabase, userId, taskId)`. Task 4's `actions.ts` server
  fns call exactly these two functions with this signature.

- [ ] **Step 1: Write the failing test**

Create `src/lib/standalone-tasks.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { createStandaloneTask, completeStandaloneTask } from './standalone-tasks'

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

test('createStandaloneTask inserts a task with a due date for its author (RLS path)', async () => {
  const { uid, userClient } = await makeSignedInUser('standalone-create')
  try {
    await createStandaloneTask(userClient, uid, 'Renew domain', '2026-08-01')

    const { data: rows } = await admin
      .from('standalone_tasks')
      .select('user_id, title, due_date, done')
      .eq('user_id', uid)
    expect(rows).toHaveLength(1)
    expect(rows![0].title).toBe('Renew domain')
    expect(rows![0].due_date).toBe('2026-08-01')
    expect(rows![0].done).toBe(false)
    expect(rows![0].user_id).toBe(uid)
  } finally {
    await admin.from('standalone_tasks').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test('createStandaloneTask defaults due date to null when omitted', async () => {
  const { uid, userClient } = await makeSignedInUser('standalone-nodue')
  try {
    await createStandaloneTask(userClient, uid, 'Call accountant')

    const { data: rows } = await admin.from('standalone_tasks').select('due_date').eq('user_id', uid)
    expect(rows).toHaveLength(1)
    expect(rows![0].due_date).toBeNull()
  } finally {
    await admin.from('standalone_tasks').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test('completeStandaloneTask marks a task done for its owning user (RLS path)', async () => {
  const { uid, userClient } = await makeSignedInUser('standalone-complete')
  try {
    await createStandaloneTask(userClient, uid, 'Pay invoice')
    const { data: created } = await admin.from('standalone_tasks').select('id').eq('user_id', uid).single()

    await completeStandaloneTask(userClient, uid, created!.id as string)

    const { data: rows } = await admin.from('standalone_tasks').select('done').eq('id', created!.id)
    expect(rows).toHaveLength(1)
    expect(rows![0].done).toBe(true)
  } finally {
    await admin.from('standalone_tasks').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test("completeStandaloneTask does not mark another user's task done", async () => {
  const { uid: ownerUid, userClient: ownerClient } = await makeSignedInUser('standalone-owner')
  const { uid: otherUid, userClient: otherClient } = await makeSignedInUser('standalone-other')
  try {
    await createStandaloneTask(ownerClient, ownerUid, 'Owner only task')
    const { data: created } = await admin.from('standalone_tasks').select('id').eq('user_id', ownerUid).single()

    await completeStandaloneTask(otherClient, otherUid, created!.id as string)

    const { data: rows } = await admin.from('standalone_tasks').select('done').eq('id', created!.id)
    expect(rows![0].done).toBe(false)
  } finally {
    await admin.from('standalone_tasks').delete().eq('user_id', ownerUid)
    await admin.from('standalone_tasks').delete().eq('user_id', otherUid)
    await admin.auth.admin.deleteUser(ownerUid)
    await admin.auth.admin.deleteUser(otherUid)
  }
}, 25000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/standalone-tasks.test.ts`
Expected: FAIL — `Failed to resolve import "./standalone-tasks"` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/standalone-tasks.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

/** Personal, project-less tasks. RLS (standalone_tasks_own) scopes all rows
 *  to user_id = auth.uid(), so no ownership check is needed here beyond
 *  passing the caller's id on create and scoping the update by it. */
export async function createStandaloneTask(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  dueDate: string | null = null,
): Promise<void> {
  const { error } = await supabase.from('standalone_tasks').insert({ user_id: userId, title, due_date: dueDate })
  if (error) throw error
}

export async function completeStandaloneTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<void> {
  const { error } = await supabase
    .from('standalone_tasks')
    .update({ done: true })
    .eq('id', taskId)
    .eq('user_id', userId)
  if (error) throw error
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/standalone-tasks.test.ts`
Expected: PASS, 4 tests. (If it fails with a Postgres "relation standalone_tasks does
not exist" error, Task 1 Step 2 — the remote migration apply — hasn't happened yet;
stop and get that confirmed first.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/standalone-tasks.ts src/lib/standalone-tasks.test.ts
git commit -m "feat: add standalone task create/complete functions"
```

---

### Task 3: Wire into `src/lib/actions.ts`

**Files:**
- Modify: `src/lib/actions.ts`

**Interfaces:**
- Consumes: `createStandaloneTask`, `completeStandaloneTask` from Task 2.
- Produces: `createStandaloneTaskFn({ data: { title, dueDate } }): Promise<{ ok: true }>`,
  `completeStandaloneTaskFn({ data: { id } }): Promise<{ ok: true }>` — both
  client-callable TanStack Start server fns. Task 4 (`QuickTaskForm.tsx`) calls
  `createStandaloneTaskFn`; Task 5 (`my-tasks.tsx`) calls `completeStandaloneTaskFn`.

No dedicated test for this task — the existing codebase doesn't unit-test the thin
`actions.ts` server-fn wrappers (`quickCreateTaskFn`, `createBoardFn` etc. have none
either); the wrapped logic is already covered by Task 2's tests, and the wrapper
itself is exercised by Task 4/5's manual browser verification.

- [ ] **Step 1: Add the import**

In `src/lib/actions.ts`, add to the top import block (after the `createCard` import
on line 7):

```typescript
import { createStandaloneTask, completeStandaloneTask } from './standalone-tasks'
```

- [ ] **Step 2: Add the two server fns**

Insert after `quickCreateTaskFn` (after the closing `})` that currently ends around
line 85, before the `createBoardFn` comment):

```typescript
// QuickTaskForm "No project" branch: a personal task with no board at all.
export const createStandaloneTaskFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { title, dueDate } = (d ?? {}) as { title?: unknown; dueDate?: unknown }
    if (typeof title !== 'string' || !title.trim()) throw new Error('title required')
    return { title: title.trim(), dueDate: typeof dueDate === 'string' && dueDate ? dueDate : null }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await createStandaloneTask(supabase, user.id, data.title, data.dueDate)
    flush(headers)
    return { ok: true }
  })

export const completeStandaloneTaskFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const id = (d as { id?: unknown })?.id
    if (typeof id !== 'string' || !id) throw new Error('id required')
    return { id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await completeStandaloneTask(supabase, user.id, data.id)
    flush(headers)
    return { ok: true }
  })
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions.ts
git commit -m "feat: expose standalone task create/complete server fns"
```

---

### Task 4: `QuickTaskForm.tsx` — "No project" option

**Files:**
- Modify: `src/components/QuickTaskForm.tsx`

**Interfaces:**
- Consumes: `createStandaloneTaskFn` from Task 3.
- Produces: no new exports — `QuickTaskForm`'s public props (`{ onDone }`) are
  unchanged.

No automated test — this codebase has no component test suite (`find src -iname
"*.test.tsx"` returns nothing); UI changes are verified manually in-browser per
CLAUDE.md convention. Verification is in Step 5 below.

- [ ] **Step 1: Add the sentinel constant and due-date state**

In `src/components/QuickTaskForm.tsx`, after the imports (after line 7), add:

```typescript
const NO_PROJECT = '__none__'
```

In the component, after the `boardId` state declaration (currently line 29), add:

```typescript
  const [dueDate, setDueDate] = useState('')
```

- [ ] **Step 2: Default board selection falls back to "No project", not empty string**

Replace the two `?? ''` fallbacks for `boardId` with `?? NO_PROJECT`:

In the `useEffect` that runs `fetchNav().then(...)` (around line 43):

```typescript
      setBoardId(nav.boards.find((b) => b.workspaceId === wsId)?.id ?? NO_PROJECT)
```

In `onWorkspaceChange` (around line 65):

```typescript
  function onWorkspaceChange(id: string) {
    setWorkspaceId(id)
    setBoardId(boards.find((b) => b.workspaceId === id)?.id ?? NO_PROJECT)
  }
```

- [ ] **Step 3: Skip the assignee fetch when "No project" is selected**

Replace the assignee-fetching `useEffect` (currently lines 48–58):

```typescript
  useEffect(() => {
    if (!boardId || boardId === NO_PROJECT) {
      setAssignees([])
      return
    }
    fetchBoardAssigneesFn({ data: { boardId } }).then(({ meId: id, members }) => {
      setMeId(id)
      setAssignees(members)
      setAssigneeId(id)
    })
  }, [boardId])
```

- [ ] **Step 4: Branch `submit()` on the sentinel, add the board-picker option and due-date input, hide workspace picker when "No project" is selected**

Replace the `submit` function (currently lines 68–82):

```typescript
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (boardId === NO_PROJECT) {
        await createStandaloneTaskFn({ data: { title, dueDate: dueDate || null } })
        onDone()
        return
      }
      const { boardId: bId } = await quickCreateTaskFn({ data: { boardId, title, assigneeId } })
      onDone()
      navigate({ to: '/board/$boardId', params: { boardId: bId } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create task')
    } finally {
      setSaving(false)
    }
  }
```

Add the import for `createStandaloneTaskFn` next to the existing `quickCreateTaskFn`
import (line 5):

```typescript
import { quickCreateTaskFn, createStandaloneTaskFn } from '#/lib/actions'
```

Replace the workspace-picker JSX condition (currently `{!lockedWorkspaceId &&
workspaces.length > 1 && (`, around line 96) to also hide when "No project" is
selected:

```typescript
      {!lockedWorkspaceId && workspaces.length > 1 && boardId !== NO_PROJECT && (
```

Replace the board-picker block (currently lines 105–115, the
`{boardsInWorkspace.length > 0 ? (...) : (...)}` ternary) with an unconditional
select that always includes the "No project" option, plus a due-date input shown
only for that branch:

```typescript
      <select value={boardId} onChange={(e) => setBoardId(e.target.value)} className="field mb-2">
        <option value={NO_PROJECT}>No project (personal note)</option>
        {boardsInWorkspace.map((b) => (
          <option key={b.id} value={b.id}>
            {b.title}
          </option>
        ))}
      </select>
      {boardsInWorkspace.length === 0 && (
        <p className="mb-2 text-[12px] text-[var(--ink3)]">
          No boards in this workspace yet — create one first, or use "No project" above.
        </p>
      )}
      {boardId === NO_PROJECT && (
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mb-2"
        />
      )}
```

- [ ] **Step 5: Manual verification in browser**

Start the dev preview (`.claude/launch.json` "dev" config, port 4321), navigate to
any page with the "+ New" quick-task entry, open it:

1. Confirm the board `<select>` shows "No project (personal note)" as an option.
2. Select it — confirm the workspace picker (if it was visible) and assignee picker
   disappear, and a date input appears.
3. Type a title, pick a date, submit — confirm the popover closes with no navigation
   (stays on the current page) and no console error.
4. Reselect a real board — confirm the date input disappears, assignee picker
   reappears, and normal board-task creation still works and navigates to the board
   as before.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/QuickTaskForm.tsx
git commit -m "feat: add No project option to quick task form"
```

---

### Task 5: `my-tasks.tsx` — surface and complete standalone tasks

**Files:**
- Modify: `src/routes/my-tasks.tsx`

**Interfaces:**
- Consumes: `completeStandaloneTaskFn` from Task 3.
- Produces: no new exports — route component behavior only.

No automated test — this route has no existing test file and no component test
convention in the repo (see Task 4). Verified manually in Step 4 below.

- [ ] **Step 1: Widen the `Task` type and merge standalone tasks into `fetchMyTasks`**

Replace the `Task` type (currently lines 8–15):

```typescript
type Task = {
  id: string
  title: string
  boardId: string | null
  boardTitle: string
  colTitle: string
  due: string | null
}
```

Replace the body of `fetchMyTasks` (currently lines 22–49, everything inside the
`try { ... } catch { return [] }`):

```typescript
  try {
    const [{ data: boards }, { data: standalone }] = await Promise.all([
      supabase
        .from('boards')
        .select('id,title,columns(title,cards(id,title,due_date,assignee_id))')
        .neq('status', 'archived'),
      supabase
        .from('standalone_tasks')
        .select('id,title,due_date')
        .eq('user_id', user.id)
        .eq('done', false),
    ])

    const tasks: Task[] = []
    for (const b of (boards ?? []) as Array<{
      id: string
      title: string
      columns?: Array<{
        title: string
        cards?: Array<{ id: string; title: string; due_date: string | null; assignee_id: string | null }>
      }>
    }>) {
      for (const col of b.columns ?? []) {
        if (isDoneColumn(col.title)) continue
        for (const c of col.cards ?? []) {
          if (c.assignee_id !== user.id) continue
          tasks.push({ id: c.id, title: c.title, boardId: b.id, boardTitle: b.title, colTitle: col.title, due: c.due_date })
        }
      }
    }
    for (const s of (standalone ?? []) as Array<{ id: string; title: string; due_date: string | null }>) {
      tasks.push({ id: s.id, title: s.title, boardId: null, boardTitle: 'Personal', colTitle: '', due: s.due_date })
    }
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return tasks
  } catch {
    return []
  }
```

(The `requireUser` line above the `try` and the surrounding function signature stay
unchanged.)

- [ ] **Step 2: Add imports for client state and the complete action**

Replace the import block at the top of the file (currently lines 1–6):

```typescript
import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { CheckSquare, ChevronRight } from 'lucide-react'
import { requireUser } from '#/lib/auth'
import { isDoneColumn, localDateStr } from '#/lib/home'
import { completeStandaloneTaskFn } from '#/lib/actions'
```

- [ ] **Step 3: Track tasks in local state and render a checkbox row for standalone tasks**

Replace the start of the `MyTasks` component (currently lines 86–88):

```typescript
function MyTasks() {
  const initialTasks = Route.useLoaderData() as Task[]
  const [tasks, setTasks] = useState(initialTasks)
  const buckets = bucketize(tasks)

  async function completeStandalone(task: Task) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    try {
      await completeStandaloneTaskFn({ data: { id: task.id } })
    } catch {
      setTasks((prev) => [...prev, task])
    }
  }
```

Replace the row-rendering block inside the `buckets.map` (currently lines 114–138,
the `{b.tasks.map((t) => ( <Link ...> ... </Link> ))}` block):

```typescript
              {b.tasks.map((t) =>
                t.boardId ? (
                  <Link
                    key={t.id}
                    to="/board/$boardId"
                    params={{ boardId: t.boardId }}
                    className="flex items-center gap-3 border-b border-[var(--line)] py-2.5 no-underline last:border-0 hover:bg-[var(--col)]"
                  >
                    <span className="h-4 w-4 shrink-0 rounded-[5px] border-2 border-[var(--ink)]" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold text-[var(--ink)]">{t.title}</p>
                      <p className="truncate text-[11px] text-[var(--ink3)]">
                        {t.boardTitle} · {t.colTitle}
                      </p>
                    </div>
                    {t.due && (
                      <span
                        className="shrink-0 text-[11px] font-bold tabular-nums"
                        style={{ color: b.key === 'overdue' ? 'var(--danger)' : 'var(--ink2)' }}
                      >
                        {fmtDue(t.due)}
                      </span>
                    )}
                    <ChevronRight size={15} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />
                  </Link>
                ) : (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => completeStandalone(t)}
                    className="flex w-full items-center gap-3 border-b border-[var(--line)] py-2.5 text-left last:border-0 hover:bg-[var(--col)]"
                  >
                    <span className="h-4 w-4 shrink-0 rounded-[5px] border-2 border-[var(--ink)]" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold text-[var(--ink)]">{t.title}</p>
                      <p className="truncate text-[11px] text-[var(--ink3)]">Personal</p>
                    </div>
                    {t.due && (
                      <span
                        className="shrink-0 text-[11px] font-bold tabular-nums"
                        style={{ color: b.key === 'overdue' ? 'var(--danger)' : 'var(--ink2)' }}
                      >
                        {fmtDue(t.due)}
                      </span>
                    )}
                  </button>
                ),
              )}
```

- [ ] **Step 4: Manual verification in browser**

With the dev preview running, navigate to `/my-tasks`:

1. Create a standalone task via the "+ New" quick form (Task 4) with a due date in
   the next few days — confirm it shows up under the correct bucket (e.g. "This
   week") tagged "Personal", with no chevron icon (since it's a `<button>`, not a
   `<Link>`).
2. Click the row — confirm it disappears immediately and does not reappear on page
   reload (i.e. it's actually marked done server-side, not just removed from local
   state).
3. Confirm existing board tasks still render as clickable links to their board and
   still navigate correctly.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/my-tasks.tsx
git commit -m "feat: surface standalone tasks in My Tasks with complete action"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 4 new ones from Task 2.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: End-to-end manual walkthrough**

Repeat the full flow once more end to end in the browser: open quick-task form →
"No project" → title + due date → submit → confirm it appears in My Tasks →
complete it → confirm it's gone and stays gone after reload. Then create a normal
board task through the same form and confirm nothing regressed (still navigates to
the board, assignee picker still works).

No commit for this task — it's a verification-only pass.
