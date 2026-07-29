# Project PIC as accounts (multiple), with notifications and a "my PIC" filter

**Date:** 2026-07-30

**Supersedes:** `2026-07-23-pic-member-picker-design.md` (single PIC as an FK on
`boards`, old text values dropped). That spec was never implemented — `boards.pic`
is still free text. This one replaces it: multiple PICs, sourced from board
members, old text values preserved as a display fallback.

**Files:** new migration `0035_board_pics.sql`, `src/lib/board-data.ts`,
`src/lib/boards.ts`, `src/lib/dashboard.ts`,
`src/routes/board.$boardId.tsx`, `src/components/ProjectEdit.tsx`,
`src/routes/projects.tsx`.

## Problem

`boards.pic` is a free-text column (`0009_project_metadata.sql`), edited via a
plain `<input>` in `ProjectEdit.tsx:133` and rendered as `· PIC {text}` in the
project header. It is a label typed by hand — it does not reference an account,
cannot be more than one person, and nothing else in the app can act on it.

The user wants:

1. PIC to reference real user accounts, and to allow more than one per project.
2. PICs and project members to be able to `@`-tag each other in task comments.
3. PICs to be notified whenever a new task is created in their project.
4. A way to see which projects they are PIC of.

## Key finding: @-mentions already work

Requirement (2) needs **no new work**. It is already built end to end:

- `src/components/Comments.tsx` — typing `@` opens an autocomplete over the
  board's members (`mentionMatches`, lines 137–170), inserts `@Name`.
- `notify_comment()` in `0031_comment_status_notifications.sql` — matches
  `@Name` against `board_members join profiles` and inserts a `kind='mention'`
  notification for each match.

The mention list is sourced from `board_members`. So once PIC is defined as a
board member, PICs are mentionable automatically. This spec must therefore keep
PIC constrained to board members — that constraint is what makes (2) free.

## Design

### Storage: a flag on `board_members`, not a new table

```sql
alter table board_members add column is_pic boolean not null default false;
```

Chosen over a separate `board_pics(board_id, user_id)` join table because:

- **The "PIC must be a member" rule is enforced by the data model**, not by
  application code. `board_members` is keyed `(board_id, user_id)`, so a PIC row
  cannot exist without the membership row it lives on.
- **Removing someone from a project clears their PIC status automatically** —
  the row is deleted, so there is no way to leave a dangling PIC who no longer
  has access. With a separate table this would need its own cascade and would
  still allow a PIC who is not a member.
- **No new RLS policies.** `0002_rls.sql` already has
  `members_owner_write on board_members for all using (is_board_owner(board_id))`,
  so the board owner can already write this column, and
  `members_read ... using (is_board_member(board_id))` already scopes reads.

### Old free-text values are kept, not dropped

`boards.pic` stays in place and is no longer written to. The project header shows
account PICs when any exist, and falls back to the old text when none do. Nothing
disappears from an existing project, and PICs can be re-entered gradually.

This is a deliberate reversal of the superseded spec, which dropped the column.
Keeping it costs one fallback expression and removes any migration risk.

### Notification on new tasks

New trigger on `cards` insert, notifying every PIC of the card's board except the
person who created it:

```sql
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('assignment', 'mention', 'status', 'pic'));
```

`notify_card_pics()`, `after insert on cards`, `security definer` (the PIC is
rarely the acting user, so RLS `user_id = auth.uid()` on `notifications` would
otherwise block the insert — same reason as `notify_card_assignee()`):

- Resolve `board_id` via `columns`.
- Insert one `kind='pic'` notification per `board_members` row with
  `is_pic = true` and `user_id <> auth.uid()`.
- Message: `'New task "' || new.title || '" in ' || board title`.
- Wrap the inserts in `begin … exception when others then null; end`, matching
  `notify_comment()`, so a notification failure can never block task creation.

**Known ceiling:** one notification per task, no batching. A project taking 20
tasks in a day sends its PICs 20 notifications. The user accepted this
explicitly; if it becomes noisy the upgrade path is a digest, which changes only
this trigger.

### "My PIC projects" filter

`fetchDashboard()` already selects `board_members` for every visible board
(`dashboard.ts:156`) — add `is_pic` to that select and compute, server-side,
`DashProject.isMyPic: boolean` (`is_pic = true` for a row whose `user_id` is the
caller's `user.id`, which is already in scope at `dashboard.ts:218`).

`/projects` (which already loads `fetchDashboard()`) gets:

- A two-way toggle: **All** / **I'm PIC**, filtering `d.projects` on `isMyPic`.
- A small `PIC` chip on rows where `isMyPic` is true, so the marker is visible in
  the unfiltered list too.

No new route, no new sidebar entry, no new server function.

### UI: picking PICs

`BoardMeta.members` (`board.$boardId.tsx:41`) gains `isPic: boolean`.

`ProjectEdit.tsx` replaces the free-text PIC `<input>` with a checkbox list over
the project's members — multi-select, unlike the single-select assignee dropdown
in `CardDetail.tsx`. Members are already fetched for this screen.

Saving PICs is a **separate call from the board-metadata save**, because PICs
live on `board_members`, not `boards`: a new `setBoardPicsFn({ boardId, userIds })`
server function that sets `is_pic = true` for the given users on that board and
`false` for the rest. `BoardMetaUpdate` is left untouched, and `boards.pic` is no
longer written.

Project header (`board.$boardId.tsx:~797`) renders `· PIC {names joined}` from
the flagged members, falling back to `board.pic` text when the list is empty.

## Out of scope

- No change to who can edit what. PIC is a label; access is still governed by
  `board_members.role`. There is deliberately no path by which marking someone
  PIC raises their permissions.
- No workspace-level PIC.
- No digest/batching of PIC notifications (see ceiling above).
- No "PIC" column in reports or exports.
- No backfill matching old text values to accounts — too fuzzy to do safely
  (a typed "Qurdho" may or may not be the account of that name).

## Testing

Integration tests in this repo hit the real remote DB via `.dev.vars`, matching
the existing suites (`src/lib/*.test.ts`).

1. **PIC set/clear** — mark two members PIC, read back, confirm exactly those two
   have `is_pic`; clear one, confirm the other survives.
2. **Membership removal clears PIC** — mark a member PIC, delete the
   `board_members` row, confirm no PIC remains for that board. This is the
   guarantee the storage choice exists to provide.
3. **New-task notification** — insert a card as user A into a board where B is
   PIC; assert B has a `kind='pic'` notification and A does not.
4. **`isMyPic`** — a board where the caller is PIC reports `isMyPic: true`, one
   where they are a plain member reports `false`.
5. **Header fallback** — a board with old text `pic` and no flagged members still
   shows the text; adding a PIC replaces it.

Typecheck (`npx tsc --noEmit -p .`) is the only automated code-quality gate.
