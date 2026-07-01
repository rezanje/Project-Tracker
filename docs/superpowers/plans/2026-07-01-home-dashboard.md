# GenTrack Home Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain boards grid on `/` with a dashboard: greeting hero with member avatars, "Today's tasks" from real cards across all boards, an aggregate activity strip, a Spotify-embed focus card, and the existing projects grid.

**Architecture:** Pure stats helpers live in a new `src/lib/home.ts` (unit-tested). A new `fetchHome` server fn in `src/routes/index.tsx` runs RLS-scoped Supabase queries (same `requireUser` + `flush` pattern as the existing `fetchBoards`) and feeds the redesigned `Home` component. Spotify is a static embed iframe — no backend.

**Tech Stack:** TanStack Start/Router, React 19, Supabase (RLS-scoped client), Tailwind v4 + existing CSS tokens, Vitest.

## Global Constraints

- Reuse existing design tokens/classes only: `--ink`/`--ink2`/`--ink3`, `--accent`, `--line`, `--card`, `--btn`, `card`, `card-hover`, `btn`, `btn-primary`, `chip`, `field`, `meadow-bg`, `page-wrap`, `gt-fade`, `display-title`. No new deps.
- All DB reads go through the RLS-scoped client from `requireUser(getRequest(), headers)`; call `flush(headers)` before returning (Supabase may rotate the session cookie).
- `due_date` is a Postgres `date`; compare against `today = new Date().toISOString().slice(0, 10)`.
- Done-column heuristic is `/done|complete/i` on the column title — use the shared `isDoneColumn` helper everywhere, never re-inline the regex.
- Spotify playlist id is fixed: `37i9dQZF1DZ06evO4pXYMW`.

---

### Task 1: Stats helpers (`src/lib/home.ts`)

**Files:**
- Create: `src/lib/home.ts`
- Test: `src/lib/home.test.ts`

**Interfaces:**
- Produces:
  - `isDoneColumn(title: string): boolean`
  - `computeStats(columns: { title: string; cards: { id: string }[] }[]): { total: number; active: number; done: number }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/home.test.ts`:

```ts
import { expect, test } from 'vitest'
import { computeStats, isDoneColumn } from './home'

test('isDoneColumn matches done/complete case-insensitively', () => {
  expect(isDoneColumn('Done')).toBe(true)
  expect(isDoneColumn('COMPLETED')).toBe(true)
  expect(isDoneColumn('In Review')).toBe(false)
  expect(isDoneColumn('Backlog')).toBe(false)
})

test('computeStats splits active vs done by column title', () => {
  const columns = [
    { title: 'Backlog', cards: [{ id: 'a' }, { id: 'b' }] },
    { title: 'In Review', cards: [{ id: 'c' }] },
    { title: 'Done', cards: [{ id: 'd' }, { id: 'e' }, { id: 'f' }] },
  ]
  expect(computeStats(columns)).toEqual({ total: 6, active: 3, done: 3 })
})

test('computeStats handles empty input', () => {
  expect(computeStats([])).toEqual({ total: 0, active: 0, done: 0 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/home.test.ts`
Expected: FAIL — cannot resolve `./home`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/home.ts`:

```ts
/** A column counts as "done" when its title reads like a done/complete state. */
export function isDoneColumn(title: string): boolean {
  return /done|complete/i.test(title)
}

/** Aggregate card counts across a user's columns. active = total - done. */
export function computeStats(
  columns: { title: string; cards: { id: string }[] }[],
): { total: number; active: number; done: number } {
  let total = 0
  let done = 0
  for (const c of columns) {
    const n = c.cards.length
    total += n
    if (isDoneColumn(c.title)) done += n
  }
  return { total, active: total - done, done }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/home.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/home.ts src/lib/home.test.ts
git commit -m "feat: home stats helpers (isDoneColumn, computeStats)"
```

---

### Task 2: `fetchHome` server fn + loader wiring (`src/routes/index.tsx`)

**Files:**
- Modify: `src/routes/index.tsx` (add `fetchHome`, extend the route loader)

**Interfaces:**
- Consumes: `computeStats`, `isDoneColumn` from `#/lib/home`; existing `requireUser`, `flush`, `listMyBoards`.
- Produces — the loader returns `{ boards, home }` where `home` is:

```ts
type HomeData = {
  name: string | null
  todayTasks: Array<{
    id: string
    title: string
    boardId: string
    status: string
    due: string | null
    owner: { name: string | null; avatar_url: string | null } | null
    label: { name: string; color: string } | null
  }>
  stats: { total: number; active: number; done: number }
  members: Array<{ name: string | null; avatar_url: string | null }>
}
```

- [ ] **Step 1: Add imports**

In `src/routes/index.tsx`, add after the existing `#/lib/boards` import:

```ts
import { computeStats, isDoneColumn } from '#/lib/home'
```

- [ ] **Step 2: Add the `fetchHome` server fn**

Insert directly below the existing `newBoard` server fn (before `export const Route`):

```ts
const fetchHome = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  const { user, supabase } = await requireUser(getRequest(), headers)
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: me }, { data: cardRows }, { data: cols }, { data: mem }] =
    await Promise.all([
      supabase.from('profiles').select('name').eq('id', user.id).single(),
      supabase
        .from('cards')
        .select(
          'id,title,due_date,columns(title,board_id),card_labels(labels(name,color)),assignee:profiles!assignee_id(name,avatar_url)',
        )
        .lte('due_date', today)
        .order('due_date'),
      supabase.from('columns').select('title,cards(id)'),
      supabase.from('board_members').select('profiles(id,name,avatar_url)'),
    ])

  // Cards embed columns/labels/assignee as (possibly single-element) arrays or
  // objects depending on the relationship; normalise defensively.
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  const todayTasks = (cardRows ?? [])
    .map((r) => {
      const col = one(r.columns) as { title: string; board_id: string } | null
      const labelJoin = one(r.card_labels) as { labels: unknown } | null
      const label = labelJoin ? (one(labelJoin.labels) as { name: string; color: string } | null) : null
      const owner = one(r.assignee) as { name: string | null; avatar_url: string | null } | null
      return {
        id: r.id as string,
        title: r.title as string,
        boardId: col?.board_id ?? '',
        status: col?.title ?? '',
        due: (r.due_date as string | null) ?? null,
        owner,
        label,
      }
    })
    .filter((t) => t.boardId && !isDoneColumn(t.status))
    .slice(0, 4)

  const stats = computeStats(
    (cols ?? []).map((c) => ({
      title: c.title as string,
      cards: (c.cards ?? []) as { id: string }[],
    })),
  )

  const seen = new Set<string>()
  const members: HomeData['members'] = []
  for (const row of mem ?? []) {
    const p = one((row as { profiles: unknown }).profiles) as
      | { id: string; name: string | null; avatar_url: string | null }
      | null
    if (p && !seen.has(p.id)) {
      seen.add(p.id)
      members.push({ name: p.name, avatar_url: p.avatar_url })
    }
  }

  flush(headers)
  return { name: me?.name ?? null, todayTasks, stats, members: members.slice(0, 5) }
})

type HomeData = {
  name: string | null
  todayTasks: Array<{
    id: string
    title: string
    boardId: string
    status: string
    due: string | null
    owner: { name: string | null; avatar_url: string | null } | null
    label: { name: string; color: string } | null
  }>
  stats: { total: number; active: number; done: number }
  members: Array<{ name: string | null; avatar_url: string | null }>
}
```

- [ ] **Step 3: Extend the loader to fetch both**

Replace the existing `loader`:

```ts
export const Route = createFileRoute('/')({
  component: Home,
  loader: async () => {
    const [boards, home] = await Promise.all([fetchBoards(), fetchHome()])
    return { boards, home }
  },
})
```

- [ ] **Step 4: Update the component's loader-data read (temporary, keeps it compiling)**

In the component (still named `Boards` at this point), change:

```ts
const boards = Route.useLoaderData()
```

to:

```ts
const { boards } = Route.useLoaderData()
```

- [ ] **Step 5: Verify typecheck + existing tests pass**

Run: `pnpm exec tsc --noEmit && pnpm vitest run`
Expected: no type errors; existing suites pass. (UI still shows the old grid — that's Task 3.)

- [ ] **Step 6: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: fetchHome server fn (today tasks, stats, members)"
```

---

### Task 3: Dashboard UI (`src/routes/index.tsx`)

**Files:**
- Modify: `src/routes/index.tsx` (rename `Boards` → `Home`, add hero avatars, Today's tasks, activity strip, Focus/Spotify card; keep the projects grid)

**Interfaces:**
- Consumes: `HomeData` from Task 2 via `const { boards, home } = Route.useLoaderData()`.

- [ ] **Step 1: Add a small avatar helper near the top of the file**

Below the existing `accentFor` helper:

```tsx
function personInitials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  const chars = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
  return chars.toUpperCase() || '?'
}

function Avatar({
  name,
  url,
  className = '',
}: {
  name: string | null
  url?: string | null
  className?: string
}) {
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? ''}
        className={`h-7 w-7 rounded-full border-2 border-[var(--card)] object-cover ${className}`}
      />
    )
  }
  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--card)] bg-[var(--accent)] text-[11px] font-bold text-white ${className}`}
    >
      {personInitials(name)}
    </span>
  )
}
```

- [ ] **Step 2: Rename the component and read both loader values**

Change `function Boards() {` to `function Home() {` and its first line to:

```tsx
const { boards, home } = Route.useLoaderData()
```

(The `component:` in the Route was already set to `Home` in Task 2, Step 3.)

- [ ] **Step 3: Replace the hero block**

Replace the existing hero `<div className="mb-7 flex flex-wrap items-end justify-between gap-5"> ... </div>` with:

```tsx
<div className="mb-8 flex flex-wrap items-end justify-between gap-5">
  <div>
    <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--ink3)]">
      {new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })}
    </p>
    <h1 className="display-title mt-1 text-4xl font-extrabold leading-none text-[var(--ink)]">
      Hi, {home.name ?? 'there'}
    </h1>
    <p className="mt-3 text-[15px] text-[var(--ink2)]">
      Here's where your projects stand today.
    </p>
  </div>
  <div className="flex items-center gap-4">
    {home.members.length > 0 && (
      <div className="flex -space-x-2">
        {home.members.map((m, i) => (
          <Avatar key={i} name={m.name} url={m.avatar_url} />
        ))}
      </div>
    )}
    <button
      type="button"
      onClick={() => newBoardRef.current?.focus()}
      className="btn btn-primary px-5 py-3 text-sm"
    >
      <span className="text-[17px] leading-none">+</span>
      New project
    </button>
  </div>
</div>
```

- [ ] **Step 4: Insert the two-column band + activity strip above the "All projects" heading**

Immediately before the existing `<div className="mb-4 flex items-baseline justify-between px-0.5">` ("All projects" heading), insert:

```tsx
<div className="mb-8 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
  {/* Today's tasks */}
  <section className="card p-5">
    <div className="mb-4 flex items-baseline justify-between">
      <h2 className="display-title text-xl font-bold text-[var(--ink)]">
        Today's tasks
      </h2>
      <span className="text-[13px] font-semibold text-[var(--ink2)]">
        {home.todayTasks.length} due
      </span>
    </div>

    {home.todayTasks.length === 0 ? (
      <p className="py-8 text-center text-sm text-[var(--ink3)]">
        Nothing due today. Clear runway.
      </p>
    ) : (
      <ul className="flex flex-col divide-y divide-[var(--line)]">
        {home.todayTasks.map((t) => (
          <li key={t.id} className="flex items-center gap-4 py-3.5">
            <div className="min-w-0 flex-1">
              {t.label && (
                <span
                  className="mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{ background: `${t.label.color}22`, color: t.label.color }}
                >
                  {t.label.name}
                </span>
              )}
              <div className="truncate font-bold text-[var(--ink)]">{t.title}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-[var(--ink3)]">
                <span>{t.status}</span>
                <span>Due {t.due ? new Date(t.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</span>
                {t.owner?.name && <span>{t.owner.name}</span>}
              </div>
            </div>
            {t.owner && <Avatar name={t.owner.name} url={t.owner.avatar_url} />}
            <a
              href={`/board/${t.boardId}`}
              className="btn btn-ghost shrink-0 px-4 py-2 text-sm no-underline"
            >
              Open
            </a>
          </li>
        ))}
      </ul>
    )}
  </section>

  {/* Focus mode / Spotify */}
  <section className="card flex flex-col gap-4 p-5">
    <h2 className="display-title text-xl font-bold text-[var(--ink)]">Focus mode</h2>
    <p className="text-sm text-[var(--ink2)]">Lo-fi & instrumental while you work.</p>
    <iframe
      src="https://open.spotify.com/embed/playlist/37i9dQZF1DZ06evO4pXYMW?utm_source=generator"
      width="100%"
      height="352"
      style={{ border: 0, borderRadius: 12 }}
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
      title="Focus playlist"
    />
  </section>
</div>

{/* Activity strip */}
<div className="card mb-8 flex items-center gap-8 p-5">
  <div>
    <div className="display-title text-3xl font-extrabold text-[var(--ink)]">
      {home.stats.total === 0 ? '0%' : `${Math.round((home.stats.done / home.stats.total) * 100)}%`}
    </div>
    <div className="text-[12px] font-semibold text-[var(--ink3)]">Progress</div>
  </div>
  <div className="h-10 w-px bg-[var(--line)]" />
  <div className="flex gap-8">
    <div>
      <div className="display-title text-2xl font-bold text-[var(--ink)]">{home.stats.total}</div>
      <div className="text-[12px] font-semibold text-[var(--ink3)]">Tasks</div>
    </div>
    <div>
      <div className="display-title text-2xl font-bold text-[var(--ink)]">{home.stats.active}</div>
      <div className="text-[12px] font-semibold text-[var(--ink3)]">Active</div>
    </div>
    <div>
      <div className="display-title text-2xl font-bold text-[var(--ink)]">{home.stats.done}</div>
      <div className="text-[12px] font-semibold text-[var(--ink3)]">Done</div>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Typecheck + tests**

Run: `pnpm exec tsc --noEmit && pnpm vitest run`
Expected: no type errors; all suites pass.

- [ ] **Step 6: Manual verification**

Run: `pnpm dev`, open `/`. Confirm: greeting shows your name; member avatars render; Today's tasks list real cards due today/overdue (or the empty state); Open → `/board/{id}`; the Spotify player loads and plays; activity strip shows counts; the "All projects" grid + create form still work.

- [ ] **Step 7: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: GenTrack home dashboard (today tasks, focus mode, activity)"
```

---

## Self-Review

- **Spec coverage:** Hero+avatars → T3.S3; Today's tasks (real, due<=today, non-done, top 4) → T2.S2 + T3.S4; label/owner/status mapping → T2.S2 + T3.S4; activity strip + progress% → T1 + T3.S4; Spotify embed → T3.S4; projects grid unchanged → retained. Done-heuristic → T1. All spec sections mapped.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `HomeData` shape defined in T2 and consumed verbatim in T3; `computeStats`/`isDoneColumn` signatures identical across T1/T2. `newBoardRef` referenced in T3.S3 already exists in the current component (unchanged).
- **Risk note for implementer:** the Supabase embed alias `assignee:profiles!assignee_id(...)` and the `columns(...)`/`card_labels(labels(...))` nesting return shapes can vary (object vs array); the `one()` normaliser handles both. If PostgREST rejects the `!assignee_id` hint, fall back to `assignee:profiles(name,avatar_url)`.
