# Command Center live panels (Timeline, Approvals, Weekly Progress, Heatmap)

**Date:** 2026-07-14
**Files:** new migration `0028_events_approvals.sql`, `src/lib/dashboard.ts`
(extend), `src/lib/events.ts` (new), `src/lib/approval-requests.ts` (new —
`src/lib/approvals.ts` already exists for the unrelated signup-approval
feature), `src/routes/index.tsx` (swap 4 static panels for real data).

## Goal

Command Center (`/`) has four panels that are still hardcoded mock arrays
(`TIMELINE`, `APPROVALS`, `WEEK`, heatmap grid) from the original pixel-mockup
build. Wire all four to real data:

- **Weekly Progress** — % of tasks due each weekday (this week) that are done.
- **Workload Heatmap** — task volume due per day, current month, by week row.
- **Today's Timeline** — scheduled events (meetings/calls/reviews) for today,
  across the user's workspaces.
- **Need Approval** — pending budget/leave/content approval requests the
  current user (as workspace owner) can act on.

## Non-goals

- No create-UI for events or approval requests yet — rows are seeded via SQL
  for now; a form comes in a later pass.
- No recurring events, reminders, or notifications tied to events.
- No editing/deleting events or approval requests from the UI.
- Approve/Reject is one-shot (no comment thread, no re-open after decision).

## 1. Weekly Progress + Workload Heatmap — no migration

Both derive from the existing `cards.due_date` + column-done-state that
`fetchDashboard` already loads. Add to the same aggregation loop in
`src/lib/dashboard.ts`:

- `weekProgress: { day: string; pct: number }[]` — for each of the 7 days of
  the current week (Mon–Sun, local time), % = done cards due that day ÷ total
  cards due that day (0 if no cards due).
- `heatmap: { week: number; day: string; count: number; intensity: number }[]`
  — for each day in the current calendar month, count of cards due that day;
  `intensity` = count ÷ max(count) across the month (0–1, for the color
  scale). Grouped into week rows (W1–W5) the same way the current static grid
  does (`Math.ceil(date / 7)`).

Both are workspace-wide (same board-membership scope as the rest of
`fetchDashboard`), matching Project Radar/Priority-Radar's non-personal
sibling panels — not filtered to the current user's assigned tasks.

## 2. `events` table — Today's Timeline

```sql
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
```

`src/lib/events.ts` exports `fetchTodayEvents()` (server fn): events for the
current user's workspaces where `starts_at` falls within today (local day),
sorted by time. Attendee avatars render from `attendee_ids` resolved against
`profiles` (name-initial, same as existing avatar-stack helper) — falls back
to no avatars if empty.

## 3. `approval_requests` table — Need Approval

```sql
create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  requested_by uuid not null references profiles,
  kind text not null check (kind in ('budget', 'leave', 'content')),
  title text not null,
  meta jsonb not null default '{}',  -- e.g. {"amount": 2300000} / {"from":"2026-07-12","to":"2026-07-14"} / {"count": 8}
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

`src/lib/approval-requests.ts` exports:
- `fetchPendingApprovals()` (server fn) — pending requests across workspaces
  where the current user is owner. Naturally personal: only shows what this
  user is authorized to act on.
- `resolveApprovalFn({ id, decision })` (server fn, `decision: 'approved' | 'rejected'`)
  — sets `status`, `resolved_by = user.id`, `resolved_at = now()`. RLS backs
  the owner-only check; the server fn re-derives workspace ownership the same
  way other write paths in this codebase do (defense in depth, matches
  `approve_*_checkin` pattern from the SMART-KPI system).

## UI changes (`src/routes/index.tsx`)

- Delete `TIMELINE`, `APPROVALS`, `WEEK`, and the static heatmap array.
- Today's Timeline / Need Approval / Weekly Progress / Workload Heatmap read
  from the loader's `fetchDashboard()` result (extended) plus a new
  `fetchTodayEvents()` / `fetchPendingApprovals()` call (parallel `Promise.all`
  in the route loader, same pattern as existing loaders).
- Need Approval's Approve/Review buttons call `resolveApprovalFn`, then
  `router.invalidate()` (existing pattern used by Goals check-in approve).
- Empty states: "Nothing scheduled today" / "No approvals pending" — same
  chip style as the other empty states already in this file (`Nothing urgent
  🎉` etc).

## Testing

- `src/lib/dashboard.test.ts` (new — no test file exists for this module yet)
  gets cases for `weekProgress` and `heatmap` math against a small fixture.
- `src/lib/approval-requests.test.ts` (new, integration against real Supabase
  per this repo's convention) — insert a pending request, resolve it as owner,
  assert status/resolved_by/resolved_at; assert a non-owner resolve is
  rejected by RLS.
- Manual: seed one `events` row and one `approval_requests` row via SQL
  Editor, verify both render in the Browser preview, verify Approve mutates
  the row and disappears from the list.

## Rollout

Migration `0028_events_approvals.sql` applied by the user via Supabase
Dashboard SQL Editor (per this repo's remote-only convention) — not run by
Claude. Everything else ships in the same PR once the migration is confirmed
applied.
