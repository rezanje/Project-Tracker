# Add an existing workspace member to a project (no email round-trip)

**Date:** 2026-07-30

**Files:** new migration `0036_workspace_member_cascade.sql`, new
`src/lib/board-members.ts` (+ tests), `src/routes/board.$boardId.tsx`.

## Problem

The only way to put someone on a project is the "Invite by email…" form in the project header
(`src/routes/board.$boardId.tsx:985-1003` → `inviteClient` in `src/lib/invites.ts`). For someone who
already has an account it works but is clumsy — the owner must recall and type their email. For
someone without an account it produces a signup link the owner has to copy and deliver by hand;
nothing is emailed (the "Task 13 emails the link" comment in `invites.ts` was never built).

That friction has a concrete consequence for the PIC feature shipped earlier today: PIC candidates
come from `board_members`, so a colleague who is in the workspace but has no `board_members` row
cannot be named PIC even though they can already open and edit the project.

## Key finding: workspace members already have access

`is_board_member`, `is_board_editor`, and `is_board_owner` (`supabase/migrations/0012_workspaces.sql:33-44`)
each have a second arm that passes for anyone in the board's workspace. So **every workspace member
can already read and edit every project in that workspace** without a `board_members` row.

Two things follow:

1. **This feature grants no new access.** It registers someone who already has access, so their name
   appears in the project's member list — which is what makes them taggable in comments, assignable to
   tasks, and eligible as PIC.
2. **A `client` role would be a lie for these people.** `is_board_editor`'s workspace arm passes
   regardless of the `board_members.role` value, so marking a workspace member `client` would not
   restrict them. They are therefore added as `member`, with no role picker.

## Design

### Picker: a dropdown plus an Add button

Beside the existing email form in the project header, owner-only (same gate). The dropdown lists
workspace members who have no `board_members` row for this project; choosing one and pressing Add
inserts the row and removes that name from the list. The email form stays exactly as it is — it
remains the only route for someone outside the workspace.

Rejected: auto-adding every workspace member to every project (every project's member list becomes
identical and everyone becomes PIC-eligible everywhere), and a multi-select panel (more UI for a
list that is realistically a handful of people).

### Revoking access stays a single action

`removeWorkspaceMember` (`src/lib/workspaces.ts:107-118`) deletes only the `workspace_members` row,
and there is no trigger on that table. Today that is sufficient, because access flows *from*
workspace membership. Once we write explicit `board_members` rows, it stops being sufficient: the
removed person keeps every board row they were added to, and each row independently grants access
through `is_board_member`'s first arm. Removing someone from the workspace would silently leave them
able to open and edit projects.

So this feature requires a cascade. A trigger on `workspace_members` delete removes that user's
`board_members` rows for boards in that workspace. Because PIC is a flag on the `board_members` row,
their PIC status goes with it — the same guarantee the PIC design relies on, extended one level up.

**Accepted consequence:** if the removed person is the `owner` of one of those boards, they lose
access to a project they created. This is intended — removal from the workspace is removal — and the
workspace owner retains full control of the board through `is_board_owner`'s workspace arm, so no
board is orphaned. Boards with `workspace_id is null` are untouched by the trigger.

### A latent bug this must not repeat

`inviteFn` (`src/routes/board.$boardId.tsx:96-109`) authorises by requiring an explicit
`board_members` row with `role = 'owner'`:

```ts
if (m?.role !== 'owner') throw new Error('forbidden')
```

But the UI shows that form whenever `isOwner` is true, and `isOwner` comes from `board-data.ts:223`
(`membership?.role ?? wsRole ?? 'client'`), which maps a *workspace* owner onto the board. A workspace
owner with no `board_members` row therefore sees the invite form and gets `forbidden` from the server.
This is the same shape of bug as the PIC no-op fixed earlier today.

The new endpoint must authorise the way `is_board_owner` does — explicit board-owner row **or**
workspace owner. Fixing `inviteFn` itself is in scope too, since it is a one-line change in the same
file and the same class of defect.

## Changes

1. **Migration `0036_workspace_member_cascade.sql`** — `after delete on workspace_members`,
   `security definer`, deletes `board_members` rows where `user_id = old.user_id` and `board_id in
   (select id from boards where workspace_id = old.workspace_id)`. Idempotent
   (`drop trigger if exists` / `create or replace function`).

2. **`src/lib/board-members.ts`** (new)
   - `listAddableWorkspaceMembers(svc, boardId): Promise<AddableMember[]>` — workspace members of the
     board's workspace minus anyone already in `board_members`. Returns `{ id, name, avatar_url }`.
     Empty array when the board has no workspace.
   - `addWorkspaceMemberToBoard(svc, boardId, userId): Promise<void>` — inserts
     `{ board_id, user_id, role: 'member' }`. Must verify `userId` really is a member of the board's
     workspace before inserting, since a service-role client bypasses RLS and the id arrives from the
     client.

3. **`src/routes/board.$boardId.tsx`**
   - A shared owner-check helper used by the new endpoints and by `inviteFn`: explicit board-owner row
     OR workspace owner of the board's workspace.
   - `fetchAddableMembersFn` (GET) and `addBoardMemberFn` (POST), both owner-gated.
   - Header UI: dropdown + Add button beside the invite form; on success refetch `boardMeta` (set it
     to `null`, matching how the PIC save refreshes the header) and reload the dropdown.

## Out of scope

- No notification to the person added (the existing email invite does not notify either).
- No "remove from this project" control — this feature only adds. Workspace removal is the revocation
  path, and it now cascades.
- No role choice for workspace members (see above — it would not restrict anything).
- No change to the email invite flow beyond the authorisation fix.
- Still no email delivery for signup-link invites; unchanged and out of scope.

## Testing

Integration tests hit the real remote DB via `.dev.vars`, matching the existing suites. Every
DB-backed test creates its users inside `try` and cleans up in `finally`, and any test asserting an
RLS outcome must use a genuinely signed-in client whose sign-in error is checked (see the hardened
`makeSignedInUser` in `src/lib/board-pics.test.ts` — the un-hardened copies silently degrade to
anonymous and pass vacuously).

1. **Addable list excludes existing board members** — a workspace with three members, one already on
   the board: the list returns exactly the other two.
2. **Addable list is empty for a board with no workspace.**
3. **Add inserts a `member` row** — after adding, the user appears in `board_members` with role
   `member`, and disappears from the addable list.
4. **Add rejects a user who is not in the board's workspace** — guards the service-role path.
5. **Cascade on workspace removal** — user is added to two boards in the workspace and flagged PIC on
   one; deleting their `workspace_members` row removes both `board_members` rows, so no PIC remains.
   This is the security-critical test.
6. **Cascade leaves other workspaces alone** — a user in two workspaces, added to a board in each;
   removal from one workspace must not touch their board row in the other.
7. **Workspace owner without a board row can add and can invite** — covers the authorisation fix; both
   endpoints must succeed for them.

Typecheck (`npx tsc --noEmit -p .`) is the only automated code-quality gate.
