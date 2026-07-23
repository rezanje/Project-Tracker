# PIC as member reference (not free text)

## Problem

`boards.pic` is a free-text column, edited via plain `<input>` in `ProjectEdit.tsx`.
Anyone can type any string — no link to an actual workspace/project account. User
wants PIC assignable from real accounts already in the project, same as task assignee.

## Approach

Convert `pic` from free text to a nullable FK (`pic_user_id -> profiles.id`), sourced
from **board members** (`board_members` table) — the same list already used for task
assignee (`CardDetail.tsx`) and shown in the project's "Member" panel. Reuses the
existing member-select UI pattern; no new component.

Old free-text `pic` values are dropped on migration (not backfilled/matched) — they
don't correspond to real accounts, so there's nothing meaningful to migrate. PIC
starts unset after this change until manually re-assigned via the dropdown.

## Changes

1. **Migration `0032_pic_user_id.sql`**
   - `alter table boards add column pic_user_id uuid references profiles(id) on delete set null;`
   - `alter table boards drop column pic;`

2. **`src/lib/board-data.ts`**
   - `BoardMeta`: replace `pic: string | null` with `picUserId: string | null` and
     `picName: string | null` (resolved same way `members` are, via join
     `board_members` -> `profiles`).
   - Update the board select query and the mapping at line 267 accordingly.

3. **`src/lib/boards.ts`**
   - `BoardMetaUpdate`: replace `pic: string | null` with `picUserId: string | null`.

4. **`src/components/ProjectEdit.tsx`**
   - Replace the free-text PIC `<input>` (line 132) with a `<select>` over
     `board.members`, mirroring the assignee picker in `CardDetail.tsx:236-249`
     (`<option value="">Unassigned</option>` + one `<option>` per member).
   - State: `picUserId` instead of `pic` string.

5. **`src/routes/board.$boardId.tsx:797`**
   - Display `meta.picName` instead of `board.pic` in the `· PIC {…}` badge.

## Out of scope

- No RLS changes — `pic_user_id` is a plain nullable FK on `boards`, existing
  owner-scoped policies on `boards` already cover it.
- No workspace-wide PIC picker — scope is board members only, consistent with
  task assignee.
- No backfill/matching of old text PIC values to accounts.

## Testing

- Typecheck (`npx tsc --noEmit -p .`) after the type changes ripple through.
- Manual: open a project, Edit project, assign PIC from dropdown, save, confirm
  badge shows member name; confirm "Unassigned" clears it.
