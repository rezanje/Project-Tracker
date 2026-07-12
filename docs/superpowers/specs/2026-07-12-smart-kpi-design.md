# SMART KPI System (assignable, time-bound, self-check-in + owner review)

**Date:** 2026-07-12
**Files:** new migration `0023_smart_kpi.sql`, `src/lib/goals.ts` (replaces
`src/lib/personal-goals.ts`), `src/components/Goals.tsx` (rework),
`src/components/TeamPanel.tsx` (add assign + review UI), `src/routes/home.tsx`
(swap personal-goals wiring for the new lib), `src/lib/notifications.ts`
(extend for check-in events).

## Goal

Today there are two disconnected, freeform goal systems:

- `kpis`/`objectives`/`key_results` — one shared number per workspace, only
  the workspace owner can edit, no periods, no per-person assignment.
- `personal_kpis`/`personal_objectives`/`personal_key_results` — private
  per-user, same freeform shape, shown on `/home`. Currently empty (no rows
  created in production).

Neither is time-bound (the "T" in SMART), neither can be assigned to a
specific staff member with the owner setting the target and the staff
reporting progress, and neither has a review step.

Replace both with one system: the owner assigns a KPI or Objective to a
person (staff or themself) with a measurable target and a start/end date;
the assignee self-check-in proposes progress; the owner approves or rejects
before the "official" number moves. This gives staff a clear, time-boxed
target they can track, and gives the owner an achievement-% view per person
to evaluate performance — without a separate rating field (achievement % is
the assessment).

## Data model — migration `0023_smart_kpi.sql`

Extend the existing `kpis` and `objectives` tables (both already exist from
`0016_kpi_okr.sql`) rather than introduce parallel ones:

```sql
alter table kpis
  add column assignee_id uuid references profiles on delete cascade,
  add column assigned_by uuid references profiles,
  add column start_date date,
  add column end_date date,
  add column status text not null default 'active'
    check (status in ('active', 'completed', 'archived'));
alter table kpis alter column workspace_id drop not null;

alter table objectives
  add column assignee_id uuid references profiles on delete cascade,
  add column assigned_by uuid references profiles,
  add column start_date date,
  add column end_date date,
  add column status text not null default 'active'
    check (status in ('active', 'completed', 'archived'));
alter table objectives alter column workspace_id drop not null;

-- Backfill required on assignee_id/assigned_by for any pre-existing rows
-- before making them not-null; today's `kpis`/`objectives` rows (if any)
-- predate assignment, so backfill assignee_id = assigned_by = owner_id of
-- the row's workspace, then set both columns not null.
update kpis set assignee_id = w.owner_id, assigned_by = w.owner_id
  from workspaces w where w.id = kpis.workspace_id and kpis.assignee_id is null;
update objectives set assignee_id = w.owner_id, assigned_by = w.owner_id
  from workspaces w where w.id = objectives.workspace_id and objectives.assignee_id is null;
alter table kpis alter column assignee_id set not null;
alter table kpis alter column assigned_by set not null;
alter table objectives alter column assignee_id set not null;
alter table objectives alter column assigned_by set not null;

-- key_results is unchanged in shape — it inherits assignee/period from its
-- parent objective, no new columns needed.

create table kpi_checkins (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references kpis on delete cascade,
  submitted_by uuid not null references profiles,
  proposed_value numeric not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references profiles,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
-- At most one pending check-in per KPI at a time.
create unique index kpi_checkins_one_pending on kpi_checkins (kpi_id) where status = 'pending';

create table kr_checkins (
  id uuid primary key default gen_random_uuid(),
  kr_id uuid not null references key_results on delete cascade,
  submitted_by uuid not null references profiles,
  proposed_value numeric not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references profiles,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index kr_checkins_one_pending on kr_checkins (kr_id) where status = 'pending';

-- personal_kpis/personal_objectives/personal_key_results are empty in
-- production — drop them outright, no data migration needed.
drop table if exists personal_key_results;
drop table if exists personal_objectives;
drop table if exists personal_kpis;
```

`current` on `kpis`/`key_results` is no longer writable by clients directly —
RLS is row-level only, so the write needs a column-level lock instead of a
trigger:

```sql
revoke update (current) on kpis from authenticated;
revoke update (current) on key_results from authenticated;
```

The `approve_*_checkin` RPC (below) is `security definer`, owned by the
migration role — it runs with the function owner's privileges regardless of
who calls it, so the column revoke doesn't apply to its own `update current`
statement. That's the only path that can move `current`.

## RLS

`kpis` / `objectives`:

```sql
drop policy if exists kpi_read on kpis;
create policy kpi_read on kpis for select
  using (assignee_id = auth.uid() or assigned_by = auth.uid());

drop policy if exists kpi_write on kpis;
create policy kpi_insert on kpis for insert with check (
  assigned_by = auth.uid()
  and (
    (workspace_id is null and assignee_id = auth.uid())
    or (workspace_id is not null and is_workspace_owner(workspace_id)
        and exists (select 1 from workspace_members
                    where workspace_id = kpis.workspace_id and user_id = kpis.assignee_id))
  )
);
create policy kpi_owner_write on kpis for update using (assigned_by = auth.uid())
  with check (assigned_by = auth.uid());
create policy kpi_owner_delete on kpis for delete using (assigned_by = auth.uid());
```

(`objectives` gets the identical four policies; `key_results` keeps its
current shape — read/write resolved through its parent `objectives` row,
unchanged from `0016_kpi_okr.sql`.)

`kpi_checkins` (mirrors `kr_checkins` against `key_results`/`objectives`):

```sql
alter table kpi_checkins enable row level security;
create policy checkin_insert on kpi_checkins for insert with check (
  submitted_by = auth.uid()
  and exists (select 1 from kpis where id = kpi_id and assignee_id = auth.uid())
);
create policy checkin_read on kpi_checkins for select using (
  submitted_by = auth.uid()
  or exists (select 1 from kpis where id = kpi_id and assigned_by = auth.uid())
);
create policy checkin_review on kpi_checkins for update using (
  exists (select 1 from kpis where id = kpi_id and assigned_by = auth.uid())
);
```

An `approve_kpi_checkin(checkin_id, approve boolean)` RPC (security definer,
`language plpgsql`, same shape as `notify_card_assignee`) does, atomically:
set the checkin's `status`/`reviewed_by`/`reviewed_at`, and — only if
`approve` is true — `update kpis set current = proposed_value where id = ...`.
Being `security definer`, that last statement runs as the function's owner
and isn't subject to the `revoke update (current) ... from authenticated`
above; a `kr_approve_checkin` RPC does the same against `key_results`.

## UX flow

1. **Assign** — Owner, from `TeamPanel` (`/workspace/$id`), picks a member →
   "Assign KPI" → name, target, unit, start/end date. Same form (workspace
   optional) reachable from `/home`'s Goals widget for self-assigned goals.
2. **Self check-in** — Assignee's `/home` Goals widget shows current
   (approved) value vs. target + a **Check-in** action (propose value + note).
   While a check-in is `pending`, the KPI shows a "Pending review" badge and
   the check-in action is disabled (enforced by the partial unique index).
3. **Review** — Submitting a check-in creates a `notifications` row for the
   owner (reuses the existing bell — same table, new message type, no schema
   change needed there). Owner approves/rejects from TeamPanel or the bell
   link; approve/reject creates a notification back to the assignee.
4. **Achievement dashboard** — TeamPanel lists each member's active
   KPIs/Objectives with achievement % (`current/target`), which is the
   performance-review surface — no separate rating field.
5. Objectives/Key Results follow the identical assign → check-in → review
   loop, one level down (check in per Key Result, not per Objective).

## Code changes

- `src/lib/goals.ts` (new, replaces `src/lib/personal-goals.ts`): server fns
  for assign, check-in, approve/reject, list-mine (assignee view),
  list-assigned-by-me (owner view).
- `src/components/Goals.tsx`: `isOwner: boolean` prop replaced with a role
  union so the same component renders the assignee's check-in form or the
  owner's approve/reject + assign form depending on who's looking.
- `src/components/TeamPanel.tsx`: add the per-member "Assign KPI" action and
  a pending-check-ins review list.
- `src/routes/home.tsx`: swap `fetchPersonalGoals`/`personalKpiSaveFn`/etc.
  for the new `goals.ts` fns.
- UI build work (once this spec is approved and a plan exists) goes through
  the `ui-ux-pro-max` skill per user preference.

## Testing

- New `src/lib/goals.test.ts`: RLS-shaped assertions mirroring
  `board-data.test.ts`/`cards.test.ts` style — assignee can insert a
  check-in for their own KPI only; non-owner cannot approve; approve copies
  `proposed_value` into `current`; a second check-in while one is pending is
  rejected (unique index).
- Manual: owner assigns KPI to a staff member in a workspace → staff sees it
  on `/home`, checks in → owner sees the bell notification, approves →
  staff's `current` updates and they get notified back.

## Out of scope (YAGNI)

Recurring/auto-resetting periods (each KPI's period is a one-off custom
range, per this design's own decision), peer visibility (staff never see
each other's KPIs), a separate numeric/star rating field beyond achievement
%, auto-computed KPIs from task/lead data, cron-based auto-expiry of KPIs
past `end_date` (owner marks `completed` manually), multi-assignee KPIs
(1 KPI = 1 person, always).
