# Dashboard: Announcement Banner, Note Detail Pages, KPI/OKR Summary

**Date:** 2026-07-04
**Files:** migration `0017`, `0018`, `src/routes/workspace.$workspaceId.tsx`,
new `src/routes/workspace.$workspaceId.notes.$noteId.tsx`,
new `src/routes/workspace.$workspaceId.goals.tsx`, `src/components/Goals.tsx`.

## Goal

Dashboard feedback from prod: announcements should read as a small top banner
(not a card), notes should be a title-only preview that opens a full editor,
and KPI/OKR on the dashboard should be a read-only summary with full
management moved to a dedicated page. Posting announcements and
editing/adding KPIs & OKRs becomes **global super admin only** (one account),
replacing the current per-workspace "owner" gate for those two features.

## Super admin (global, not per-workspace)

Today `announcements`/`kpis`/`objectives`/`key_results` write policies use
`is_workspace_owner(workspace_id)` — any workspace's own owner can post/edit
for their workspace. That changes to a single global flag.

Migration `0017_super_admin.sql`:

```sql
alter table profiles add column is_super_admin boolean not null default false;

create function is_super_admin() returns boolean language sql security definer stable as $$
  select coalesce((select is_super_admin from profiles where id = auth.uid()), false);
$$;

drop policy ann_owner_write on announcements;
create policy ann_owner_write on announcements for all
  using (is_super_admin()) with check (is_super_admin());

drop policy kpi_write on kpis;
create policy kpi_write on kpis for all
  using (is_super_admin()) with check (is_super_admin());

drop policy obj_write on objectives;
create policy obj_write on objectives for all
  using (is_super_admin()) with check (is_super_admin());

drop policy kr_write on key_results;
create policy kr_write on key_results for all using (
  exists (select 1 from objectives o where o.id = objective_id and is_super_admin()))
  with check (
  exists (select 1 from objectives o where o.id = objective_id and is_super_admin()));
```

After migration, flip your row manually:
`update profiles set is_super_admin = true where id = '<your auth uid>';`

Read policies (`ann_read`, `kpi_read`, `obj_read`, `kr_read`) are unchanged —
any workspace member still reads. Team management (invite/set role/remove
member) is untouched — that stays gated on the existing per-workspace `owner`
role; it's a separate concept from the new global flag.

`fetchHome` gains an `isSuperAdmin` field, read from `profiles.is_super_admin`
for the current user, returned alongside the existing `wsRole`/`isWsOwner`.

## Announcement banner

- Dashboard query drops from `.limit(5)` to `.limit(1)` — only the latest
  announcement is fetched.
- The existing "Announcements" card is removed from the 2-column grid.
- A slim banner strip renders between the hero header and the
  Clock/Overdue row: left-aligned announcement body, small
  "`{author} · {date}`" meta. No dismiss state — it simply shows whatever is
  latest, and disappears on its own once nothing is queued (no announcement →
  no banner).
- If `isSuperAdmin`, a compact inline compose control sits with the banner
  (a small "+ Announce" toggle that reveals a single-line input + Post
  button, collapses after posting). Non-admins never see it.

## Notes

Migration `0018_notes_detail.sql`:

```sql
alter table notes add column title text not null default '';
update notes set title = left(body, 60) where title = '';
alter table notes add column board_id uuid references boards on delete set null;
```

`body` keeps its column name but is now treated as the long "detail" field.
RLS (`notes_own`, private to `user_id = auth.uid()`) is unchanged — notes stay
personal, not workspace-scoped. `board_id` is optional ("related project");
when set it must belong to a board the note's owner can already read (no new
RLS needed, since the reader is always the note's own author selecting from
boards they're a member of).

- **Dashboard card**: title-only rows, quick-add input still creates a note
  (title = input text, detail empty, board_id null). Inline × delete stays
  for fast cleanup. Clicking a row title navigates to the note's page instead
  of expanding inline.
- **New route** `workspace.$workspaceId.notes.$noteId.tsx`: loader fetches the
  note (title, body/detail, board_id) plus the list of boards in that
  workspace (for the related-project `<select>`, with a "None" option). Page
  has title input, a full-height textarea for detail, the board select, Save,
  and Delete. Back link returns to the workspace dashboard. Ownership is
  enforced by existing RLS — a stale/foreign note id 404s via `.maybeSingle()`
  returning null.
- New server fns: `updateNoteFn({ id, title, body, boardId })`. Existing
  `addNoteFn`/`deleteNoteFn` stay, `addNoteFn` validator gains `title`
  (falls back to using the quick-add text as title, empty body).

## KPI/OKR

- Dashboard reuses the existing `Goals` component **forced read-only**
  (`isOwner={false}` regardless of admin status) fed sliced data: first 3
  KPIs + first 3 OKRs ordered by `created_at desc` (most recently added
  first). Passing `isOwner={false}` already hides all of `Goals`'s add/edit/
  delete forms and inputs — no new component needed.
- Below the summary, a "Manage KPIs & OKRs →" link to
  `workspace.$workspaceId.goals.tsx`.
- **New route** `workspace.$workspaceId.goals.tsx`: own loader fetching the
  full (unsliced) kpis/objectives+key_results for the workspace plus
  `isSuperAdmin`. Renders `<Goals kpis okrs isOwner={isSuperAdmin} .../>` —
  same component, full list, full CRUD wired exactly like today's dashboard
  wiring (`kpiSaveFn`, `objAddFn`, `krSaveFn`, etc., unchanged). Any
  workspace member can view the page; only the super admin sees editable
  controls, and the new RLS backs that up server-side regardless of what the
  client sends.

## Testing

- Manual (no automated RLS test suite exists for these tables today — follow
  existing pattern only if adding one): as super admin, confirm posting an
  announcement / editing a KPI / adding an OKR still works; as a regular
  workspace owner (non-super-admin), confirm those writes now fail (RLS
  42501) and the UI doesn't show the controls.
- Manual: quick-add a note, click its title, edit detail + set a related
  project, save, reload dashboard — title preview reflects the edit.
- Manual: confirm dashboard KPI/OKR summary shows the 3 most recent of each
  when more than 3 exist, and the Manage page shows all of them with working
  add/edit/delete as super admin.

## Out of scope (YAGNI)

Banner dismiss/read-tracking, multiple simultaneous banners, note reminders/
due dates (confirmed `created_at` is enough), linking notes to anything other
than a board, per-KPI/OKR "featured" pinning (summary is simply most-recent-3),
a UI to grant/revoke `is_super_admin` (single account, set once via SQL).
