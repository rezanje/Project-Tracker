# Command Center Live Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4 hardcoded mock arrays on Command Center (`/`) —
Today's Timeline, Need Approval, Weekly Progress, Workload Heatmap — with
real data.

**Architecture:** Weekly Progress and Workload Heatmap are pure aggregations
over the existing `cards.due_date` (no schema change). Timeline and
Approvals get two new tables (`events`, `approval_requests`) with
workspace-scoped RLS reusing the existing `is_workspace_member` /
`is_workspace_owner` helpers from migration `0012_workspaces.sql`. Two new
`src/lib` modules follow this codebase's established split: a plain
`SupabaseClient`-taking function (directly unit/integration-testable) plus a
thin `createServerFn` wrapper that calls `requireUser` and delegates to it —
same shape as `src/lib/cards.ts` / `src/lib/goals.ts`.

**Tech Stack:** TanStack Start server functions, Supabase (Postgres + RLS),
Vitest (integration tests hit the real remote DB per this repo's
`.dev.vars`-based convention — no mocks, no local DB).

## Global Constraints

- No local Supabase/Docker. The new migration is applied by the user via the
  Supabase Dashboard SQL Editor — Claude does not run it. Task 1 ends with a
  **STOP and ask the user to confirm** gate; do not start Task 4 or Task 5
  until they confirm the migration is live on the remote DB.
- No create-UI for events or approval requests in this plan — rows are
  seeded via SQL for manual/Task-7 verification. Read-only + Approve/Reject
  only.
- Match existing file conventions exactly: `src/lib/approvals.ts` already
  exists (unrelated signup-approval feature) — the new module is
  `src/lib/approval-requests.ts`, not `approvals.ts`.
- Typecheck gate for every task: `npx tsc --noEmit -p .` must report no
  errors before that task's commit.

---

### Task 1: Migration `0028_events_approvals.sql`

**Files:**
- Create: `supabase/migrations/0028_events_approvals.sql`

**Interfaces:**
- Produces: tables `events` (`id, workspace_id, title, sub, event_type,
  starts_at, attendee_ids, created_at`) and `approval_requests` (`id,
  workspace_id, requested_by, kind, title, meta, status, resolved_by,
  resolved_at, created_at`), both RLS-enabled, reusing
  `is_workspace_member(workspace_id)` / `is_workspace_owner(workspace_id)`
  (already defined in `supabase/migrations/0012_workspaces.sql`).

- [ ] **Step 1: Write the migration file**

```sql
-- Events (Today's Timeline) and approval_requests (Need Approval) — both
-- feed previously-static Command Center panels with real, per-workspace
-- data. Reuses is_workspace_member/is_workspace_owner from 0012_workspaces.sql.

create table events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  title text not null,
  sub text,
  event_type text not null check (event_type in ('Meeting', 'Approval', 'Call', 'Review', 'Content')),
  starts_at timestamptz not null,
  attendee_ids uuid[] not null default '{}',
  created_at timestamptz default now()
);
alter table events enable row level security;
create policy events_read on events for select using (is_workspace_member(workspace_id));
create policy events_write on events for all
  using (is_workspace_owner(workspace_id)) with check (is_workspace_owner(workspace_id));

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  requested_by uuid not null references profiles,
  kind text not null check (kind in ('budget', 'leave', 'content')),
  title text not null,
  meta jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  resolved_by uuid references profiles,
  resolved_at timestamptz,
  created_at timestamptz default now()
);
alter table approval_requests enable row level security;
create policy approval_requests_read on approval_requests for select using (is_workspace_member(workspace_id));
create policy approval_requests_insert on approval_requests for insert with check (is_workspace_member(workspace_id));
create policy approval_requests_resolve on approval_requests for update
  using (is_workspace_owner(workspace_id)) with check (is_workspace_owner(workspace_id));
```

- [ ] **Step 2: Verify the file is syntactically consistent with existing migrations**

Run: `tail -30 supabase/migrations/0012_workspaces.sql` and confirm
`is_workspace_member`/`is_workspace_owner` signatures (`(w uuid) returns
boolean`) match how they're called above (`is_workspace_member(workspace_id)`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0028_events_approvals.sql
git commit -m "$(cat <<'EOF'
feat: add events and approval_requests tables

New migration for two previously-static Command Center panels
(Today's Timeline, Need Approval). RLS reuses is_workspace_member /
is_workspace_owner from 0012_workspaces.sql.
EOF
)"
```

- [ ] **Step 4: STOP — get migration applied**

Tell the user: *"Migration `0028_events_approvals.sql` is committed. Apply
it to the remote DB via Supabase Dashboard → SQL Editor (paste the file,
Run), then run `npx supabase migration repair --status applied 0028
--db-url "<pooler-url>"`. Reply here once it's applied — Tasks 4 and 5 need
the tables to exist on the real remote DB (this repo has no local
Supabase)."*

**Do not proceed to Task 4 or Task 5 until the user confirms.** Tasks 2, 3,
and the non-DB parts of 6 don't touch these tables and can proceed in the
meantime.

---

### Task 2: Date helpers — `weekdayIndex` / `weekRange`

**Files:**
- Modify: `src/lib/home.ts`
- Test: `src/lib/home.test.ts`

**Interfaces:**
- Produces: `weekdayIndex(dateStr: string): number` (0=Mon..6=Sun),
  `weekRange(dateStr: string): string[]` (7 local `YYYY-MM-DD` strings,
  Monday first, for the week containing `dateStr`). Both exported from
  `src/lib/home.ts`, consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/home.test.ts` (append after the existing tests, add
`weekdayIndex, weekRange` to the existing `import { computeStats,
isDoneColumn } from './home'` line):

```ts
test('weekdayIndex is Monday-start (0=Mon..6=Sun)', () => {
  expect(weekdayIndex('2026-07-13')).toBe(0) // Monday
  expect(weekdayIndex('2026-07-14')).toBe(1) // Tuesday
  expect(weekdayIndex('2026-07-19')).toBe(6) // Sunday
})

test('weekRange returns the local Mon..Sun dates for the week containing dateStr', () => {
  expect(weekRange('2026-07-14')).toEqual([
    '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16',
    '2026-07-17', '2026-07-18', '2026-07-19',
  ])
})

test('weekRange on a Sunday stays in that same week (does not roll into the next one)', () => {
  expect(weekRange('2026-07-19')).toEqual([
    '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16',
    '2026-07-17', '2026-07-18', '2026-07-19',
  ])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/home.test.ts`
Expected: FAIL — `weekdayIndex is not defined` / `weekRange is not defined`.

- [ ] **Step 3: Implement**

Add to `src/lib/home.ts` (after `localDateStr`):

```ts
/** Monday-start weekday index (0=Mon..6=Sun) for a local `YYYY-MM-DD` date string. */
export function weekdayIndex(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  return (d.getDay() + 6) % 7
}

/** Local `YYYY-MM-DD` dates for the Monday..Sunday week containing `dateStr`. */
export function weekRange(dateStr: string): string[] {
  const d = new Date(dateStr + 'T00:00:00')
  const monday = new Date(d)
  monday.setDate(d.getDate() - weekdayIndex(dateStr))
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    return localDateStr(day)
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/home.test.ts`
Expected: PASS (all tests in the file, existing + new).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/home.ts src/lib/home.test.ts
git commit -m "$(cat <<'EOF'
feat: add weekdayIndex/weekRange date helpers

Monday-start weekday math for the Weekly Progress and Workload
Heatmap panels (Task 3 consumes these).
EOF
)"
```

---

### Task 3: Weekly Progress + Workload Heatmap aggregation

**Files:**
- Modify: `src/lib/dashboard.ts`
- Test: Create `src/lib/dashboard.test.ts`

**Interfaces:**
- Consumes: `weekdayIndex`, `weekRange` from `./home` (Task 2).
- Produces: `computeWeekProgress(cards, todayStr): Array<{ d: string; v:
  number }>`, `computeHeatmap(cards, todayStr): number[][]` (5 rows × 7
  cols, `grid[week][weekday]`, both exported from `src/lib/dashboard.ts`).
  `DashboardData` gains `weekProgress: Array<{ d: string; v: number }>`,
  `heatmap: number[][]`, `monthLabel: string`. Consumed by Task 6
  (`src/routes/index.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/dashboard.test.ts`:

```ts
import { expect, test } from 'vitest'
import { computeWeekProgress, computeHeatmap } from './dashboard'

test('computeWeekProgress computes % done per weekday for the week containing todayStr', () => {
  const cards = [
    { due_date: '2026-07-13', done: true },  // Mon
    { due_date: '2026-07-13', done: false }, // Mon
    { due_date: '2026-07-14', done: true },  // Tue
    { due_date: '2026-07-20', done: true },  // next week, ignored
    { due_date: null, done: true },          // no due date, ignored
  ]
  expect(computeWeekProgress(cards, '2026-07-14')).toEqual([
    { d: 'Mon', v: 50 },
    { d: 'Tue', v: 100 },
    { d: 'Wed', v: 0 },
    { d: 'Thu', v: 0 },
    { d: 'Fri', v: 0 },
    { d: 'Sat', v: 0 },
    { d: 'Sun', v: 0 },
  ])
})

test('computeWeekProgress returns all zeros for an empty card list', () => {
  const result = computeWeekProgress([], '2026-07-14')
  expect(result.every((d) => d.v === 0)).toBe(true)
  expect(result.map((d) => d.d)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
})

test('computeHeatmap buckets task volume into a 5x7 Mon-start grid, scaled to the busiest day', () => {
  const cards = [
    { due_date: '2026-07-01' }, // Wed, week 1
    { due_date: '2026-07-01' },
    { due_date: '2026-07-08' }, // Wed, week 2 (busiest: 4)
    { due_date: '2026-07-08' },
    { due_date: '2026-07-08' },
    { due_date: '2026-07-08' },
    { due_date: '2026-06-30' }, // different month, ignored
  ]
  const grid = computeHeatmap(cards, '2026-07-14')
  expect(grid).toHaveLength(5)
  expect(grid[0]).toHaveLength(7)
  expect(grid[0][2]).toBe(50)  // week 1, Wed: 2/4 busiest
  expect(grid[1][2]).toBe(100) // week 2, Wed: 4/4 busiest
  expect(grid[0][0]).toBe(0)   // week 1, Mon: no cards
})

test('computeHeatmap returns an all-zero 5x7 grid for an empty card list', () => {
  const grid = computeHeatmap([], '2026-07-14')
  expect(grid).toHaveLength(5)
  expect(grid.every((row) => row.every((v) => v === 0))).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/dashboard.test.ts`
Expected: FAIL — `computeWeekProgress is not defined` / `computeHeatmap is not defined`.

- [ ] **Step 3: Implement**

In `src/lib/dashboard.ts`, change the import line to add the two new
helpers:

```ts
import { isDoneColumn, localDateStr, weekdayIndex, weekRange } from './home'
```

Add after `dayDiff` (before `fetchDashboard`):

```ts
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** % of cards due each weekday (Mon..Sun) of the week containing `todayStr` that are done. */
export function computeWeekProgress(
  cards: Array<{ due_date: string | null; done: boolean }>,
  todayStr: string,
): Array<{ d: string; v: number }> {
  const days = weekRange(todayStr)
  const totals = days.map(() => ({ total: 0, done: 0 }))
  const indexOf = new Map(days.map((d, i) => [d, i]))
  for (const c of cards) {
    if (!c.due_date) continue
    const i = indexOf.get(c.due_date)
    if (i === undefined) continue
    totals[i].total++
    if (c.done) totals[i].done++
  }
  return totals.map((t, i) => ({ d: WEEKDAY_LABELS[i], v: t.total ? Math.round((t.done / t.total) * 100) : 0 }))
}

/** Task volume per day of the month containing `todayStr`, grouped into Mon-start
 *  week rows (`grid[week][weekday]`), intensity 0-100 relative to the busiest day. */
export function computeHeatmap(cards: Array<{ due_date: string | null }>, todayStr: string): number[][] {
  const [y, m] = todayStr.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const counts = new Map<string, number>()
  const monthPrefix = todayStr.slice(0, 7)
  for (const c of cards) {
    if (!c.due_date || !c.due_date.startsWith(monthPrefix)) continue
    counts.set(c.due_date, (counts.get(c.due_date) ?? 0) + 1)
  }
  const max = Math.max(1, ...counts.values())
  const grid: number[][] = Array.from({ length: 5 }, () => Array(7).fill(0))
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${monthPrefix}-${String(day).padStart(2, '0')}`
    const count = counts.get(dateStr) ?? 0
    const week = Math.ceil(day / 7) - 1
    grid[week][weekdayIndex(dateStr)] = Math.round((count / max) * 100)
  }
  return grid
}
```

In the `fetchDashboard` handler, declare an accumulator alongside the other
`let`/`const` accumulators (near `const myToday_: DashTask[] = []`):

```ts
    const allCards: Array<{ due_date: string | null; done: boolean }> = []
```

Inside the card loop, right after `bTotal++`, add:

```ts
          allCards.push({ due_date: c.due_date, done: isDone })
```

After the `bucketRank`/sort block (after `myPriority.sort(...)`), add:

```ts
    const weekProgress = computeWeekProgress(allCards, today)
    const heatmap = computeHeatmap(allCards, today)
    const monthLabel = new Date(today + 'T00:00:00').toLocaleDateString('en-US', { month: 'long' })
```

Add `weekProgress`, `heatmap`, `monthLabel` to the success return object
(next to `myToday: myToday_.slice(0, 6),`):

```ts
      weekProgress,
      heatmap,
      monthLabel,
```

Add matching fields to the `DashboardData` type (next to `myToday: DashTask[]`):

```ts
  weekProgress: Array<{ d: string; v: number }>
  heatmap: number[][]
  monthLabel: string
```

Add fallback values to the `catch` block's return object (next to `myToday: [],`):

```ts
      weekProgress: WEEKDAY_LABELS.map((d) => ({ d, v: 0 })),
      heatmap: Array.from({ length: 5 }, () => Array(7).fill(0)),
      monthLabel: '',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/dashboard.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard.ts src/lib/dashboard.test.ts
git commit -m "$(cat <<'EOF'
feat: compute real Weekly Progress and Workload Heatmap data

Both derive from cards.due_date (no schema change) — % done per
weekday this week, and task volume per day this month scaled to the
busiest day. src/routes/index.tsx wiring is Task 6.
EOF
)"
```

---

### Task 4: `src/lib/events.ts` — Today's Timeline

**Requires:** Task 1's migration confirmed applied to the remote DB.

**Files:**
- Create: `src/lib/events.ts`
- Test: Create `src/lib/events.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `./auth`, `localDateStr` from `./home`.
- Produces: `EventItem = { id: string; time: string; title: string; sub:
  string; type: string; people: number }`, `listTodayEvents(supabase:
  SupabaseClient, todayStr?: string): Promise<EventItem[]>`,
  `fetchTodayEventsFn` (`createServerFn`, no args). Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/lib/events.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { listTodayEvents } from './events'

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

async function mkUser(tag: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}.${Date.now()}@gmail.com`,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: tag },
  })
  if (error) throw error
  return data.user
}

test('listTodayEvents returns only events starting today, earliest first, with attendee count', async () => {
  const owner = await mkUser('evowner')
  let workspaceId: string | undefined
  let eventIds: string[] = []
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Events Test Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id

    const { data: rows } = await admin
      .from('events')
      .insert([
        { workspace_id: workspaceId, title: 'Late meeting', sub: 'Team', event_type: 'Meeting', starts_at: '2026-07-14T15:00:00+00', attendee_ids: [owner.id] },
        { workspace_id: workspaceId, title: 'Early call', sub: 'Client', event_type: 'Call', starts_at: '2026-07-14T09:00:00+00', attendee_ids: [] },
        { workspace_id: workspaceId, title: 'Tomorrow review', sub: 'Design', event_type: 'Review', starts_at: '2026-07-15T09:00:00+00', attendee_ids: [] },
      ])
      .select('id')
    eventIds = (rows ?? []).map((r) => r.id as string)

    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    await anon.auth.signInWithPassword({
      email: (await admin.auth.admin.getUserById(owner.id)).data.user!.email!,
      password: 'Babikeguling1!',
    })

    const list = await listTodayEvents(anon, '2026-07-14')
    expect(list.map((e) => e.title)).toEqual(['Early call', 'Late meeting'])
    expect(list[0]).toMatchObject({ time: '09:00', title: 'Early call', sub: 'Client', type: 'Call', people: 0 })
    expect(list[1]).toMatchObject({ time: '15:00', title: 'Late meeting', sub: 'Team', type: 'Meeting', people: 1 })
  } finally {
    if (eventIds.length) await admin.from('events').delete().in('id', eventIds)
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 20000)

test('events_read RLS policy hides events from non-members', async () => {
  const owner = await mkUser('evowner2')
  const outsider = await mkUser('evoutsider')
  let workspaceId: string | undefined
  let eventId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Events RLS Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id
    const { data: ev } = await admin
      .from('events')
      .insert({ workspace_id: workspaceId, title: 'Private meeting', event_type: 'Meeting', starts_at: '2026-07-14T10:00:00+00' })
      .select('id')
      .single()
    eventId = ev!.id

    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    await anon.auth.signInWithPassword({
      email: (await admin.auth.admin.getUserById(outsider.id)).data.user!.email!,
      password: 'Babikeguling1!',
    })

    const list = await listTodayEvents(anon, '2026-07-14')
    expect(list.find((e) => e.id === eventId)).toBeUndefined()
  } finally {
    if (eventId) await admin.from('events').delete().eq('id', eventId)
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(outsider.id)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 20000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/events.test.ts`
Expected: FAIL — `Failed to resolve import "./events"` (file doesn't exist yet).

- [ ] **Step 3: Implement**

Create `src/lib/events.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireUser } from './auth'
import { localDateStr } from './home'

export type EventItem = { id: string; time: string; title: string; sub: string; type: string; people: number }

/** Local HH:MM for a timestamptz string, e.g. '2026-07-14T09:00:00+00' -> '09:00'. */
function timeOf(startsAt: string): string {
  const d = new Date(startsAt)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Events starting today (local day) across whatever workspaces `supabase`'s
 *  RLS-scoped caller belongs to, earliest first. No explicit workspace
 *  filter — same pattern as fetchDashboard's boards query, RLS does the scoping. */
export async function listTodayEvents(supabase: SupabaseClient, todayStr: string = localDateStr()): Promise<EventItem[]> {
  const { data } = await supabase
    .from('events')
    .select('id,title,sub,event_type,starts_at,attendee_ids')
    .gte('starts_at', `${todayStr}T00:00:00`)
    .lte('starts_at', `${todayStr}T23:59:59`)
    .order('starts_at')
  return ((data ?? []) as Array<{
    id: string
    title: string
    sub: string | null
    event_type: string
    starts_at: string
    attendee_ids: string[]
  }>).map((r) => ({
    id: r.id,
    time: timeOf(r.starts_at),
    title: r.title,
    sub: r.sub ?? '',
    type: r.event_type,
    people: r.attendee_ids.length,
  }))
}

export const fetchTodayEventsFn = createServerFn({ method: 'GET' }).handler(async (): Promise<EventItem[]> => {
  const headers = new Headers()
  const { supabase } = await requireUser(getRequest(), headers)
  try {
    const list = await listTodayEvents(supabase)
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return list
  } catch {
    return []
  }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/events.test.ts`
Expected: PASS (2 tests). If the first test fails with a Postgres error
about the `events` table not existing, STOP — the Task 1 migration gate
wasn't actually cleared; go back and confirm with the user.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/events.ts src/lib/events.test.ts
git commit -m "$(cat <<'EOF'
feat: add listTodayEvents / fetchTodayEventsFn

Today's Timeline data source. RLS (events_read, workspace-member
scoped) does the workspace filtering — no explicit filter needed.
src/routes/index.tsx wiring is Task 6.
EOF
)"
```

---

### Task 5: `src/lib/approval-requests.ts` — Need Approval

**Requires:** Task 1's migration confirmed applied to the remote DB.

**Files:**
- Create: `src/lib/approval-requests.ts`
- Test: Create `src/lib/approval-requests.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `./auth`.
- Produces: `ApprovalKind = 'budget' | 'leave' | 'content'`,
  `ApprovalRequest = { id: string; kind: ApprovalKind; title: string; sub:
  string; meta: string }`, `formatApprovalMeta(kind, meta: Record<string,
  unknown>): string`, `listPendingApprovals(supabase, userId):
  Promise<ApprovalRequest[]>`, `resolveApproval(supabase, userId, id,
  decision: 'approved' | 'rejected'): Promise<void>`,
  `fetchPendingApprovalsFn` (`createServerFn`, no args), `resolveApprovalFn`
  (`createServerFn`, `{ id: string; decision: 'approved' | 'rejected' }`).
  Consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/approval-requests.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { formatApprovalMeta, listPendingApprovals, resolveApproval } from './approval-requests'

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

async function mkUser(tag: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}.${Date.now()}@gmail.com`,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: tag },
  })
  if (error) throw error
  return data.user
}

// ─── Unit tests (no DB) ─────────────────────────────────────────────────────

test('formatApprovalMeta formats budget as Rupiah', () => {
  expect(formatApprovalMeta('budget', { amount: 2300000 })).toBe('Rp 2.300.000')
})

test('formatApprovalMeta formats leave as a date range', () => {
  expect(formatApprovalMeta('leave', { from: '2026-07-12', to: '2026-07-14' })).toBe('2026-07-12 - 2026-07-14')
})

test('formatApprovalMeta formats content as a count', () => {
  expect(formatApprovalMeta('content', { count: 8 })).toBe('8 Konten')
})

// ─── DB-backed tests ────────────────────────────────────────────────────────

test('listPendingApprovals returns only pending requests for workspaces the user owns', async () => {
  const owner = await mkUser('apowner')
  let workspaceId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Approval Test Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id

    await admin.from('approval_requests').insert([
      { workspace_id: workspaceId, requested_by: owner.id, kind: 'budget', title: 'Pending one', meta: { amount: 500000 }, status: 'pending' },
      { workspace_id: workspaceId, requested_by: owner.id, kind: 'leave', title: 'Already resolved', meta: {}, status: 'approved' },
    ])

    const list = await listPendingApprovals(admin, owner.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual({
      id: expect.any(String),
      kind: 'budget',
      title: 'Pending one',
      sub: 'Approval Test Workspace',
      meta: 'Rp 500.000',
    })
  } finally {
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 20000)

test('resolveApproval sets status, resolved_by, and resolved_at', async () => {
  const owner = await mkUser('apresolve')
  let workspaceId: string | undefined
  let requestId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Resolve Test Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id
    const { data: req } = await admin
      .from('approval_requests')
      .insert({ workspace_id: workspaceId, requested_by: owner.id, kind: 'content', title: 'Resolve me', meta: { count: 3 } })
      .select('id')
      .single()
    requestId = req!.id

    await resolveApproval(admin, owner.id, requestId!, 'approved')

    const { data: row } = await admin
      .from('approval_requests')
      .select('status,resolved_by,resolved_at')
      .eq('id', requestId)
      .single()
    expect(row?.status).toBe('approved')
    expect(row?.resolved_by).toBe(owner.id)
    expect(row?.resolved_at).toBeTruthy()
  } finally {
    if (requestId) await admin.from('approval_requests').delete().eq('id', requestId)
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 20000)

test('approval_requests_resolve RLS policy blocks a non-owner update', async () => {
  const owner = await mkUser('rlsowner')
  const member = await mkUser('rlsmember')
  let workspaceId: string | undefined
  let requestId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'RLS Test Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id
    await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: member.id, role: 'member' })
    const { data: req } = await admin
      .from('approval_requests')
      .insert({ workspace_id: workspaceId, requested_by: owner.id, kind: 'budget', title: 'Owner only', meta: { amount: 1 } })
      .select('id')
      .single()
    requestId = req!.id

    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    await anon.auth.signInWithPassword({
      email: (await admin.auth.admin.getUserById(member.id)).data.user!.email!,
      password: 'Babikeguling1!',
    })

    await anon.from('approval_requests').update({ status: 'approved' }).eq('id', requestId)
    const { data: row } = await admin.from('approval_requests').select('status').eq('id', requestId).single()
    expect(row?.status).toBe('pending') // RLS silently matched 0 rows — update didn't apply
  } finally {
    if (requestId) await admin.from('approval_requests').delete().eq('id', requestId)
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(member.id)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 20000)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/approval-requests.test.ts`
Expected: FAIL — `Failed to resolve import "./approval-requests"` (file doesn't exist yet).

- [ ] **Step 3: Implement**

Create `src/lib/approval-requests.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireUser } from './auth'

export type ApprovalKind = 'budget' | 'leave' | 'content'
export type ApprovalRequest = { id: string; kind: ApprovalKind; title: string; sub: string; meta: string }

/** Rp / date-range / count copy per request kind, from the request's jsonb `meta`. */
export function formatApprovalMeta(kind: ApprovalKind, meta: Record<string, unknown>): string {
  if (kind === 'budget') return `Rp ${(Number(meta.amount) || 0).toLocaleString('id-ID')}`
  if (kind === 'leave') return `${meta.from ?? ''} - ${meta.to ?? ''}`
  return `${Number(meta.count) || 0} Konten`
}

/** Pending requests across workspaces `userId` owns — what they're personally
 *  authorized to act on (narrower than the events_read-style "any member can
 *  see it exists" RLS read policy). */
export async function listPendingApprovals(supabase: SupabaseClient, userId: string): Promise<ApprovalRequest[]> {
  const { data } = await supabase
    .from('approval_requests')
    .select('id,kind,title,meta,workspaces!inner(name,owner_id)')
    .eq('workspaces.owner_id', userId)
    .eq('status', 'pending')
    .order('created_at')
  return ((data ?? []) as Array<{
    id: string
    kind: ApprovalKind
    title: string
    meta: Record<string, unknown>
    workspaces: { name: string; owner_id: string } | { name: string; owner_id: string }[]
  }>).map((r) => {
    const ws = Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces
    return { id: r.id, kind: r.kind, title: r.title, sub: ws?.name ?? '', meta: formatApprovalMeta(r.kind, r.meta) }
  })
}

/** Resolve a pending request. RLS (`approval_requests_resolve`) restricts this to
 *  workspace owners; the `.eq('status','pending')` guard stops a second click
 *  from re-resolving an already-decided row. */
export async function resolveApproval(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const { error } = await supabase
    .from('approval_requests')
    .update({ status: decision, resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
  if (error) throw error
}

export const fetchPendingApprovalsFn = createServerFn({ method: 'GET' }).handler(async (): Promise<ApprovalRequest[]> => {
  const headers = new Headers()
  const { user, supabase } = await requireUser(getRequest(), headers)
  try {
    const list = await listPendingApprovals(supabase, user.id)
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return list
  } catch {
    return []
  }
})

export const resolveApprovalFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { id, decision } = (d ?? {}) as { id?: unknown; decision?: unknown }
    if (typeof id !== 'string' || !id) throw new Error('id required')
    if (decision !== 'approved' && decision !== 'rejected') throw new Error('decision must be approved or rejected')
    return { id, decision }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await resolveApproval(supabase, user.id, data.id, data.decision)
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return { ok: true }
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/approval-requests.test.ts`
Expected: PASS (6 tests). If a DB-backed test fails with a Postgres error
about `approval_requests` not existing, STOP — the Task 1 migration gate
wasn't actually cleared; go back and confirm with the user.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/approval-requests.ts src/lib/approval-requests.test.ts
git commit -m "$(cat <<'EOF'
feat: add listPendingApprovals / resolveApproval / server fns

Need Approval data source + working Approve/Reject. Named
approval-requests.ts (not approvals.ts — that file already exists
for the unrelated signup-approval feature). src/routes/index.tsx
wiring is Task 6.
EOF
)"
```

---

### Task 6: Wire Command Center (`src/routes/index.tsx`)

**Requires:** Tasks 3, 4, 5 complete.

**Files:**
- Modify: `src/routes/index.tsx`

**Interfaces:**
- Consumes: `fetchDashboard`, `type DashboardData` from `#/lib/dashboard`
  (now includes `weekProgress`, `heatmap`, `monthLabel`);
  `fetchTodayEventsFn`, `type EventItem` from `#/lib/events`;
  `fetchPendingApprovalsFn`, `resolveApprovalFn`, `type ApprovalRequest`
  from `#/lib/approval-requests`.

- [ ] **Step 1: Update imports and route loader**

Replace the top of the file (lines 1–25) with:

```tsx
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  AlertTriangle,
  Banknote,
  FileText,
  Image as ImageIcon,
  Info,
  Lightbulb,
  Sparkles,
  Star,
  TrendingUp,
  Truck,
  X,
} from 'lucide-react'
import { Building2, Clock, Flame, FolderKanban, ListChecks } from '@/components/pixel-icons'
import { fetchDashboard, type DashboardData } from '#/lib/dashboard'
import { fetchTodayEventsFn, type EventItem } from '#/lib/events'
import { fetchPendingApprovalsFn, resolveApprovalFn, type ApprovalRequest, type ApprovalKind } from '#/lib/approval-requests'

type CommandCenterData = DashboardData & { events: EventItem[]; approvals: ApprovalRequest[] }

export const Route = createFileRoute('/')({
  loader: async (): Promise<CommandCenterData> => {
    const [dashboard, events, approvals] = await Promise.all([
      fetchDashboard(),
      fetchTodayEventsFn(),
      fetchPendingApprovalsFn(),
    ])
    return { ...dashboard, events, approvals }
  },
  component: CommandCenter,
})
```

- [ ] **Step 2: Delete the now-unused static arrays**

`AI_ITEMS` stays untouched — that panel remains a static "Coming Soon" shell
per the spec's non-goals. Delete only `TIMELINE`, `APPROVALS`, and `WEEK`
(the three fully-replaced arrays):

```tsx
const TIMELINE = [
  { time: '09:00', title: 'Meeting Produksi', sub: 'Gentanala', type: 'Meeting', people: 3 },
  { time: '11:00', title: 'Approve Budget Q3', sub: 'Disma Fresh', type: 'Approval', people: 1 },
  { time: '13:30', title: 'Call with Client A', sub: 'Konsultan', type: 'Call', people: 2 },
  { time: '15:00', title: 'Review Design Sistem', sub: 'Gentanala • Website', type: 'Review', people: 1 },
  { time: '17:00', title: 'Upload Konten IG', sub: 'Gentanala • Marketing', type: 'Content', people: 1 },
]
const APPROVALS = [
  { icon: Banknote, title: 'Budget Production Q3', sub: 'Gentanala', meta: 'Rp 2.300.000', action: 'Review' },
  { icon: FileText, title: 'Cuti Karyawan - Dimas', sub: 'Disma Fresh', meta: '12 - 14 July', action: 'Approve' },
  { icon: ImageIcon, title: 'Konten Campaign Juli', sub: 'Gentanala • Marketing', meta: '8 Konten', action: 'Review' },
]
const WEEK = [
  { d: 'Mon', v: 55 },
  { d: 'Tue', v: 48 },
  { d: 'Wed', v: 62 },
  { d: 'Thu', v: 58 },
  { d: 'Fri', v: 95 },
  { d: 'Sat', v: 30 },
  { d: 'Sun', v: 22 },
]
```

Keep `TYPE_COLORS` (still used, now keyed by real `event_type` values) and
`SPARK` (still used by Portfolio Overview, out of scope). Add a kind→icon
lookup right after `TYPE_COLORS`:

```tsx
const APPROVAL_ICON: Record<ApprovalKind, typeof Banknote> = {
  budget: Banknote,
  leave: FileText,
  content: ImageIcon,
}
```

- [ ] **Step 3: Add the resolve handler**

Inside `function CommandCenter() {`, right after `const d =
Route.useLoaderData() as CommandCenterData` (update that cast from
`DashboardData` to `CommandCenterData`), add:

```tsx
  const router = useRouter()
  async function handleResolve(id: string, decision: 'approved' | 'rejected') {
    await resolveApprovalFn({ data: { id, decision } })
    router.invalidate()
  }
```

- [ ] **Step 4: Swap Today's Timeline**

Replace:

```tsx
              {TIMELINE.map((t) => (
                <div key={t.time} className="flex items-center gap-3 border-b border-[var(--line)] py-2 last:border-0">
```

with:

```tsx
              {d.events.length === 0 && (
                <p className="py-4 text-center text-sm text-[var(--ink3)]">Nothing scheduled today 🎉</p>
              )}
              {d.events.map((t) => (
                <div key={t.id} className="flex items-center gap-3 border-b border-[var(--line)] py-2 last:border-0">
```

(the rest of that block — `t.time`, `t.type`, `t.title`, `t.sub`,
`<Avatars n={t.people} />` — is unchanged; field names match exactly).

- [ ] **Step 5: Swap Need Approval**

Replace the whole `<section className="card p-4 lg:col-span-3">` /
`CardHead title="Need Approval"` block's body:

```tsx
            <div className="flex flex-col gap-2">
              {APPROVALS.map((a) => (
                <div key={a.title} className="rounded-[10px] border-2 border-[var(--line)] p-2.5">
                  <div className="flex items-center gap-2">
                    <a.icon size={16} className="shrink-0 text-[var(--ink2)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-bold text-[var(--ink)]">{a.title}</p>
                      <p className="truncate text-[11px] text-[var(--ink3)]">{a.sub}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[12px] font-bold text-[var(--ink)]">{a.meta}</span>
                    <button type="button" className="btn btn-primary px-3 py-1 text-[12px]">
                      {a.action}
                    </button>
                  </div>
                </div>
              ))}
            </div>
```

with:

```tsx
            {d.approvals.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--ink3)]">No approvals pending 🎉</p>
            ) : (
              <div className="flex flex-col gap-2">
                {d.approvals.map((a) => {
                  const Icon = APPROVAL_ICON[a.kind]
                  return (
                    <div key={a.id} className="rounded-[10px] border-2 border-[var(--line)] p-2.5">
                      <div className="flex items-center gap-2">
                        <Icon size={16} className="shrink-0 text-[var(--ink2)]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-bold text-[var(--ink)]">{a.title}</p>
                          <p className="truncate text-[11px] text-[var(--ink3)]">{a.sub}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[12px] font-bold text-[var(--ink)]">{a.meta}</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            className="btn btn-primary px-3 py-1 text-[12px]"
                            onClick={() => handleResolve(a.id, 'approved')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            aria-label="Reject"
                            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--line)] text-[var(--ink2)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
                            onClick={() => handleResolve(a.id, 'rejected')}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
```

- [ ] **Step 6: Swap Workload Heatmap**

Replace `<CardHead title="Workload Heatmap (July)" />` with:

```tsx
            <CardHead title={`Workload Heatmap (${d.monthLabel})`} />
```

Replace:

```tsx
              {['W1', 'W2', 'W3', 'W4', 'W5'].map((w, r) => (
                <div key={w} className="flex items-center gap-1.5">
                  <span className="w-6 text-[10px] font-bold text-[var(--ink3)]">{w}</span>
                  {Array.from({ length: 7 }).map((_, c) => {
                    const lvl = (r * 3 + c * 2) % 5
                    return (
                      <span
                        key={c}
                        className="h-4 flex-1 rounded-[3px] border border-[var(--line)]"
                        style={{ background: `color-mix(in oklab, var(--accent) ${lvl * 22}%, var(--col))` }}
                      />
                    )
                  })}
                </div>
              ))}
```

with:

```tsx
              {['W1', 'W2', 'W3', 'W4', 'W5'].map((w, r) => (
                <div key={w} className="flex items-center gap-1.5">
                  <span className="w-6 text-[10px] font-bold text-[var(--ink3)]">{w}</span>
                  {d.heatmap[r].map((intensity, c) => (
                    <span
                      key={c}
                      className="h-4 flex-1 rounded-[3px] border border-[var(--line)]"
                      style={{ background: `color-mix(in oklab, var(--accent) ${intensity}%, var(--col))` }}
                    />
                  ))}
                </div>
              ))}
```

- [ ] **Step 7: Swap Weekly Progress**

Replace `{WEEK.map((b) => (` with `{d.weekProgress.map((b) => (` (the rest
of that block is unchanged — `b.d`/`b.v` field names match exactly).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors. If `TIMELINE`/`APPROVALS`/`WEEK` show up as unused,
confirm every reference was replaced in Steps 4/5/7.

- [ ] **Step 9: Commit**

```bash
git add src/routes/index.tsx
git commit -m "$(cat <<'EOF'
feat: wire Command Center to real Timeline/Approvals/Progress/Heatmap

Replaces the 4 hardcoded mock arrays with fetchTodayEventsFn,
fetchPendingApprovalsFn (+ working Approve/Reject), and dashboard.ts's
new weekProgress/heatmap/monthLabel fields.
EOF
)"
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `home.test.ts`,
`dashboard.test.ts`, `events.test.ts`, `approval-requests.test.ts` cases.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Seed manual test data**

In the Supabase Dashboard SQL Editor, run (swap in a real `workspace_id`
and `profile id` from your own account):

```sql
insert into events (workspace_id, title, sub, event_type, starts_at, attendee_ids)
values ('<your-workspace-id>', 'Design Review', 'Gentanala', 'Review', now(), '{}');

insert into approval_requests (workspace_id, requested_by, kind, title, meta)
values ('<your-workspace-id>', '<your-profile-id>', 'budget', 'Test Budget Approval', '{"amount": 1500000}');
```

- [ ] **Step 4: Verify in the Browser preview**

Use `preview_start` (dev server) and `navigate` to `/`. Confirm:
- Today's Timeline shows "Design Review" at the current time.
- Need Approval shows "Test Budget Approval — Rp 1.500.000" with
  Approve/Reject buttons.
- Weekly Progress bars and Workload Heatmap render without throwing
  (check `read_console_messages` for errors).
- Click Approve → row disappears from Need Approval (verify via
  `read_network_requests` that `resolveApprovalFn` returned 200, and
  re-query `approval_requests` in the SQL Editor to confirm `status =
  'approved'`).

- [ ] **Step 5: Clean up seeded rows**

```sql
delete from events where title = 'Design Review';
delete from approval_requests where title = 'Test Budget Approval';
```

- [ ] **Step 6: Report**

Summarize to the user: tests passing, typecheck clean, manual verification
screenshot/notes. No commit needed for this task (verification only).
