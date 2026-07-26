# My Tasks grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each task's workspace in its subtitle, and let the user switch `/my-tasks` between Due date (default, unchanged), Project, and Workspace grouping.

**Architecture:** The `Task` type, the group type, and the grouping functions move out of `src/routes/my-tasks.tsx` into a new `src/lib/my-tasks.ts` so they can be unit-tested without pulling server-only imports into the test runner (mirroring the existing `src/lib/home.ts` + `home.test.ts` pair). All three modes emit the same `Group[]` shape, so the route's existing render loop is reused verbatim — no new JSX branch.

**Tech Stack:** TanStack Start (React), Supabase (PostgREST embeds), Vitest.

## Global Constraints

- No ESLint config — `npx tsc --noEmit -p .` is the only automated code-quality gate.
- `vitest.config.ts` sets `fileParallelism: false` (the shared remote Supabase auth
  API rate-limits under parallel load). Do not change it. The new test in this plan
  is a **pure unit test with no database access** — do not add DB calls to it.
- Most existing tests hit the real remote DB via `.dev.vars`; this plan's test is
  deliberately not one of them. Follow `src/lib/progress.test.ts` / the non-DB
  portion of `src/lib/cards.test.ts` for plain unit-test style.
- Due date mode must stay **byte-identical in behaviour** — same buckets, labels,
  tints, ordering, and thresholds. It is the default and is not being redesigned.
- `boards.workspace_id` is nullable (migration 0012). Every board currently has a
  workspace, but the fallback path must still exist and be tested.
- `accentFor` currently lives in `src/components/Sidebar.tsx`, but a Node vitest
  test **cannot** import from there — verified empirically: it fails with
  `Cannot find package '@/components/pixel-icons'`, because `vitest.config.ts`
  declares no `@/` alias and Sidebar pulls in the component tree. Task 1 therefore
  moves the canonical copy to `src/lib/accent.ts` and makes Sidebar re-export it,
  so `MobileNav.tsx` (its only importer) is unaffected and no new duplicate is
  created. Do **not** touch the six other independent `accentFor` copies
  (`WorkspaceDashboard.tsx`, `routes/index.tsx`, `reports.tsx`, `home.tsx`,
  `calendar.tsx`, `board.$boardId.tsx`) — out of scope.
- Do not name any type `Pick` — it shadows TypeScript's built-in `Pick<T,K>`
  utility inside the module.
- Standalone tasks have `boardId === null` and `workspaceId === null`; that is the
  intended discriminator (established by the standalone-tasks feature). Do not add
  a separate flag.

---

### Task 1: Extract `src/lib/my-tasks.ts` and add workspace fields

**Files:**
- Create: `src/lib/accent.ts`
- Create: `src/lib/my-tasks.ts`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/routes/my-tasks.tsx`

**Interfaces:**
- Produces: `accentFor` from `src/lib/accent.ts`; `Task`, `Group`, `bucketize`
  from `src/lib/my-tasks.ts`. Task 2 adds `groupBy` to the same module and Task 3
  consumes all of it from the route.

This task is a pure move plus two new fields. No behaviour changes.

- [ ] **Step 1: Create `src/lib/accent.ts` and re-export it from Sidebar**

Create `src/lib/accent.ts` with the function moved verbatim from `Sidebar.tsx:28-33`:

```typescript
const ACCENTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']

/** Stable colour for an id — same id always yields the same accent, so a
 *  workspace or board keeps one colour across the sidebar, dashboards, and
 *  the My Tasks group dots. */
export function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}
```

In `src/components/Sidebar.tsx`, delete the `ACCENTS` const and the `accentFor`
function (lines 28-33) and replace them with a re-export so `MobileNav.tsx`'s
`import { accentFor } from './Sidebar'` keeps working untouched:

```typescript
export { accentFor } from '#/lib/accent'
```

Sidebar uses `accentFor` internally too, so confirm the re-export satisfies those
uses; if TypeScript objects to using a re-exported binding locally, import it as
well: `import { accentFor } from '#/lib/accent'` alongside the re-export.

- [ ] **Step 2: Create `src/lib/my-tasks.ts`**

Move `Task`, the group type (renamed `Bucket` → `Group`), and `bucketize` out of
the route. `bucketize`'s body is unchanged apart from the type rename.

```typescript
import { localDateStr } from './home'

export type Task = {
  id: string
  title: string
  boardId: string | null
  boardTitle: string
  colTitle: string
  workspaceId: string | null
  workspaceName: string
  due: string | null
}

/** One rendered section of the My Tasks list. Every grouping mode produces this
 *  same shape so the route renders them all through one loop. */
export type Group = { key: string; label: string; tint: string; tasks: Task[] }

export function bucketize(tasks: Task[]): Group[] {
  const today = localDateStr()
  const in7 = localDateStr(new Date(Date.now() + 7 * 86_400_000))
  const buckets: Group[] = [
    { key: 'overdue', label: 'Overdue', tint: 'var(--danger)', tasks: [] },
    { key: 'today', label: 'Today', tint: '#d97706', tasks: [] },
    { key: 'week', label: 'This week', tint: '#2563eb', tasks: [] },
    { key: 'later', label: 'Later', tint: 'var(--ink3)', tasks: [] },
    { key: 'none', label: 'No due date', tint: 'var(--ink3)', tasks: [] },
  ]
  const by = Object.fromEntries(buckets.map((b) => [b.key, b])) as Record<string, Group>
  for (const t of tasks) {
    if (!t.due) by.none.tasks.push(t)
    else if (t.due < today) by.overdue.tasks.push(t)
    else if (t.due === today) by.today.tasks.push(t)
    else if (t.due <= in7) by.week.tasks.push(t)
    else by.later.tasks.push(t)
  }
  for (const b of buckets) b.tasks.sort((a, z) => (a.due ?? '') < (z.due ?? '') ? -1 : 1)
  return buckets.filter((b) => b.tasks.length > 0)
}
```

- [ ] **Step 3: Update the route to import them and populate the new fields**

In `src/routes/my-tasks.tsx`:

Delete the local `type Task = {...}` block, the `type Bucket = ...` line, and the
whole `bucketize` function. Add to the imports:

```typescript
import { bucketize, type Task } from '#/lib/my-tasks'
```

Do **not** also import `Group` — the route never names that type (the render loop
infers it), and `tsconfig` has `noUnusedLocals`, so an unused import fails the
typecheck.

`isDoneColumn` and `localDateStr` are still imported from `#/lib/home` — but
`localDateStr` is now only used by `bucketize`, which moved. Remove it from the
`#/lib/home` import if the route no longer references it, leaving
`import { isDoneColumn } from '#/lib/home'`. (Task 3 re-introduces a
`localDateStr` use; re-add it there rather than leaving an unused import now,
because `tsconfig` has `noUnusedLocals`.)

Widen the board query to fetch the workspace:

```typescript
      supabase
        .from('boards')
        .select('id,title,workspace_id,workspaces(name),columns(title,cards(id,title,due_date,assignee_id))')
        .neq('status', 'archived'),
```

Widen the board row type and populate the two new fields. Replace the board loop:

```typescript
    const tasks: Task[] = []
    for (const b of (boards ?? []) as Array<{
      id: string
      title: string
      workspace_id: string | null
      workspaces?: { name: string } | null
      columns?: Array<{
        title: string
        cards?: Array<{ id: string; title: string; due_date: string | null; assignee_id: string | null }>
      }>
    }>) {
      const workspaceName = b.workspaces?.name ?? 'No workspace'
      for (const col of b.columns ?? []) {
        if (isDoneColumn(col.title)) continue
        for (const c of col.cards ?? []) {
          if (c.assignee_id !== user.id) continue
          tasks.push({
            id: c.id,
            title: c.title,
            boardId: b.id,
            boardTitle: b.title,
            colTitle: col.title,
            workspaceId: b.workspace_id,
            workspaceName,
            due: c.due_date,
          })
        }
      }
    }
```

And the standalone loop:

```typescript
    for (const s of (standalone ?? []) as Array<{ id: string; title: string; due_date: string | null }>) {
      tasks.push({
        id: s.id,
        title: s.title,
        boardId: null,
        boardTitle: 'Personal',
        colTitle: '',
        workspaceId: null,
        workspaceName: 'Personal',
        due: s.due_date,
      })
    }
```

- [ ] **Step 4: Update the subtitle to include the workspace**

In `TaskRowContent`, replace the subtitle line:

```typescript
        <p className="truncate text-[11px] text-[var(--ink3)]">
          {task.boardId ? `${task.workspaceName} · ${task.boardTitle} · ${task.colTitle}` : task.boardTitle}
        </p>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors. If it reports an unused `localDateStr` import in the route,
remove it (see Step 3).

- [ ] **Step 6: Verify nothing regressed in the browser**

The dev server runs from `.claude/launch.json` ("dev", port 4321) and the user is
logged in. Load `/my-tasks` and confirm:
- the page still renders the same Overdue / This week sections as before
- every board-task subtitle now reads `Workspace · Project · Column`
  (e.g. `Gentanala · Vobia ERP · Backlog`)
- a standalone task, if any is open, still reads just `Personal`

- [ ] **Step 7: Commit**

```bash
git add src/lib/accent.ts src/lib/my-tasks.ts src/components/Sidebar.tsx src/routes/my-tasks.tsx
git commit -m "refactor: extract My Tasks grouping types and add workspace to rows"
```

---

### Task 2: `groupBy` and its unit tests

**Files:**
- Modify: `src/lib/my-tasks.ts`
- Test: `src/lib/my-tasks.test.ts`

**Interfaces:**
- Consumes: `Task`, `Group` from Task 1.
- Produces: `groupBy(tasks, pick): Group[]`, the `Grouper` type, and the
  `byProject` / `byWorkspace` grouper functions, all exported. Task 3 calls these from the route.

- [ ] **Step 1: Write the failing test**

Create `src/lib/my-tasks.test.ts`. This is a pure unit test — no DB, no `.dev.vars`.

```typescript
import { expect, test } from 'vitest'
import { groupBy, byProject, byWorkspace, type Task } from './my-tasks'

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: over.id,
    boardId: 'b1',
    boardTitle: 'Board One',
    colTitle: 'Backlog',
    workspaceId: 'w1',
    workspaceName: 'Workspace One',
    due: null,
    ...over,
  }
}

test('byProject groups tasks under their board title', () => {
  const groups = groupBy(
    [
      task({ id: 'a', boardId: 'b1', boardTitle: 'Alpha', due: '2026-07-01' }),
      task({ id: 'b', boardId: 'b2', boardTitle: 'Beta', due: '2026-07-02' }),
      task({ id: 'c', boardId: 'b1', boardTitle: 'Alpha', due: '2026-07-03' }),
    ],
    byProject,
  )
  expect(groups.map((g) => g.label)).toEqual(['Alpha', 'Beta'])
  expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'c'])
  expect(groups[1].tasks.map((t) => t.id)).toEqual(['b'])
})

test('byWorkspace groups tasks under their workspace name', () => {
  const groups = groupBy(
    [
      task({ id: 'a', workspaceId: 'w1', workspaceName: 'Gentanala', due: '2026-07-01' }),
      task({ id: 'b', workspaceId: 'w2', workspaceName: 'GenDev', due: '2026-07-02' }),
      task({ id: 'c', workspaceId: 'w1', workspaceName: 'Gentanala', due: '2026-07-05' }),
    ],
    byWorkspace,
  )
  expect(groups.map((g) => g.label)).toEqual(['Gentanala', 'GenDev'])
  expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'c'])
})

test('standalone tasks collapse into one Personal group in both modes', () => {
  const standalone = [
    task({ id: 's1', boardId: null, boardTitle: 'Personal', workspaceId: null, workspaceName: 'Personal', due: '2026-07-01' }),
    task({ id: 's2', boardId: null, boardTitle: 'Personal', workspaceId: null, workspaceName: 'Personal', due: '2026-07-02' }),
  ]
  for (const pick of [byProject, byWorkspace]) {
    const groups = groupBy(standalone, pick)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Personal')
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['s1', 's2'])
  }
})

test('two boards sharing a title stay separate groups (keyed by id)', () => {
  const groups = groupBy(
    [
      task({ id: 'a', boardId: 'b1', boardTitle: 'Website', due: '2026-07-01' }),
      task({ id: 'b', boardId: 'b2', boardTitle: 'Website', due: '2026-07-02' }),
    ],
    byProject,
  )
  expect(groups).toHaveLength(2)
  expect(groups.every((g) => g.label === 'Website')).toBe(true)
})

test('tasks sort by due date ascending with undated last', () => {
  const groups = groupBy(
    [
      task({ id: 'none', due: null }),
      task({ id: 'late', due: '2026-07-20' }),
      task({ id: 'early', due: '2026-07-02' }),
    ],
    byProject,
  )
  expect(groups[0].tasks.map((t) => t.id)).toEqual(['early', 'late', 'none'])
})

test('groups sort by earliest due date, undated groups last', () => {
  const groups = groupBy(
    [
      task({ id: 'a', boardId: 'b1', boardTitle: 'Later', due: '2026-07-20' }),
      task({ id: 'b', boardId: 'b2', boardTitle: 'Undated', due: null }),
      task({ id: 'c', boardId: 'b3', boardTitle: 'Urgent', due: '2026-07-01' }),
    ],
    byProject,
  )
  expect(groups.map((g) => g.label)).toEqual(['Urgent', 'Later', 'Undated'])
})

test('groups with the same earliest due date tie-break alphabetically', () => {
  const groups = groupBy(
    [
      task({ id: 'a', boardId: 'b1', boardTitle: 'Zebra', due: '2026-07-01' }),
      task({ id: 'b', boardId: 'b2', boardTitle: 'Apple', due: '2026-07-01' }),
    ],
    byProject,
  )
  expect(groups.map((g) => g.label)).toEqual(['Apple', 'Zebra'])
})

test('a board with no workspace surfaces as No workspace', () => {
  const groups = groupBy(
    [task({ id: 'a', workspaceId: null, workspaceName: 'No workspace', due: '2026-07-01' })],
    byWorkspace,
  )
  expect(groups[0].label).toBe('No workspace')
})

test('every group gets a non-empty tint', () => {
  const groups = groupBy([task({ id: 'a', due: '2026-07-01' })], byProject)
  expect(groups[0].tint).toBeTruthy()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/my-tasks.test.ts`
Expected: FAIL — `groupBy`, `byProject`, `byWorkspace` are not exported from
`./my-tasks` yet.

- [ ] **Step 3: Implement `groupBy`**

Append to `src/lib/my-tasks.ts`, and add `accentFor` to its imports:

```typescript
import { accentFor } from './accent'
```

```typescript
/** How a task maps onto a group. Named Grouper, not Pick, because `Pick` would
 *  shadow TypeScript's built-in Pick<T,K> utility inside this module.
 *  Keyed by id rather than label so two boards
 *  that happen to share a title stay separate; standalone tasks (null ids)
 *  collapse into one 'personal' group. */
export type Grouper = (t: Task) => { key: string; label: string }

export const byProject: Grouper = (t) => ({ key: t.boardId ?? 'personal', label: t.boardTitle })
export const byWorkspace: Grouper = (t) => ({ key: t.workspaceId ?? 'personal', label: t.workspaceName })

/** Undated tasks sort last within a group, and all-undated groups sort last
 *  overall — an absent due date is "whenever", not "now". */
const FAR_FUTURE = '9999-12-31'

export function groupBy(tasks: Task[], pick: Grouper): Group[] {
  const groups = new Map<string, Group>()
  for (const t of tasks) {
    const { key, label } = pick(t)
    let g = groups.get(key)
    if (!g) {
      g = { key, label, tint: accentFor(key), tasks: [] }
      groups.set(key, g)
    }
    g.tasks.push(t)
  }
  const out = [...groups.values()]
  for (const g of out) g.tasks.sort((a, z) => (a.due ?? FAR_FUTURE).localeCompare(z.due ?? FAR_FUTURE))
  out.sort((a, z) => {
    const ea = a.tasks[0]?.due ?? FAR_FUTURE
    const ez = z.tasks[0]?.due ?? FAR_FUTURE
    return ea === ez ? a.label.localeCompare(z.label) : ea.localeCompare(ez)
  })
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/my-tasks.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/my-tasks.ts src/lib/my-tasks.test.ts
git commit -m "feat: add project and workspace grouping for My Tasks"
```

---

### Task 3: Segmented control in the route

**Files:**
- Modify: `src/routes/my-tasks.tsx`

**Interfaces:**
- Consumes: `bucketize`, `groupBy`, `byProject`, `byWorkspace` from `src/lib/my-tasks.ts`.
- Produces: no new exports.

- [ ] **Step 1: Add mode state and pick the group source**

Update the route's imports:

```typescript
import { bucketize, groupBy, byProject, byWorkspace, type Task } from '#/lib/my-tasks'
import { isDoneColumn, localDateStr } from '#/lib/home'
```

In `MyTasks`, replace the `const buckets = bucketize(tasks)` line with:

```typescript
  const [mode, setMode] = useState<'due' | 'project' | 'workspace'>('due')
  const groups =
    mode === 'project' ? groupBy(tasks, byProject)
    : mode === 'workspace' ? groupBy(tasks, byWorkspace)
    : bucketize(tasks)
  // Overdue is a property of the task, not of the group it landed in: in
  // project/workspace mode there is no 'overdue' group, but an overdue date
  // must still render red.
  const today = localDateStr()
```

- [ ] **Step 2: Render the segmented control**

Insert directly after the closing `</div>` of the heading row (the one containing
the `<h1>` and the `{tasks.length} open` chip), before the `{tasks.length === 0 &&`
block:

```typescript
        <div className="flex w-fit gap-0 overflow-hidden rounded-full border border-[var(--line)]">
          {([
            ['due', 'Due date'],
            ['project', 'Project'],
            ['workspace', 'Workspace'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`px-3.5 py-1.5 text-[12px] font-bold ${
                mode === value
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--ink2)] hover:bg-[var(--col)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
```

- [ ] **Step 3: Render from `groups` and fix the overdue tint**

Replace `{buckets.map((b) => (` with `{groups.map((b) => (`.

Both `<TaskRowContent .../>` call sites currently pass `overdue={b.key === 'overdue'}`,
which is only correct in Due date mode. Change **both** to:

```typescript
                    <TaskRowContent task={t} overdue={!!t.due && t.due < today} showChevron />
```

and for the standalone `<button>` branch:

```typescript
                    <TaskRowContent task={t} overdue={!!t.due && t.due < today} showChevron={false} />
```

This is equivalent to the old expression in Due date mode (every task in the
`overdue` bucket has `due < today` by construction) and correct in the two new
modes.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Verify in the browser**

The dev server runs from `.claude/launch.json` ("dev", port 4321); the user is
logged in. Load `/my-tasks` and confirm:

- The segmented control shows `Due date | Project | Workspace` with **Due date**
  active, and the list below is unchanged from before this plan.
- Clicking **Project** regroups into one section per board, each headed by the
  board title with a coloured dot and a count. Overdue dates are still red.
- Clicking **Workspace** regroups into one section per workspace (e.g. `Gentanala`,
  `GenDev Studio`).
- The most urgent group appears first in both new modes.
- Clicking **Due date** returns to the original view.
- No console errors (`read_console_messages`).

Take a screenshot of Project mode to share as proof.

- [ ] **Step 6: Full suite and commit**

Run: `npm test`
Expected: all pass, including the 9 new unit tests.

```bash
git add src/routes/my-tasks.tsx
git commit -m "feat: add grouping mode switcher to My Tasks"
```
