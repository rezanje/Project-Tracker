# Member Role + Role-Aware Invites

**Date:** 2026-07-03
**Files:** migration `0011`, `src/lib/invites.ts`, `src/routes/board.$boardId.tsx`,
`src/components/{Column,Card,CardDetail}.tsx`.

## Goal

Add a third per-project role, **member** (staff who can do task work), between
**owner** (full control) and **client** (read-only). The owner picks the role
when inviting and gets a shareable invite link. Members can be assigned tasks
and act on them; clients stay view+comment only.

## Roles (per board)

| Capability | owner | member | client |
|---|---|---|---|
| View board, comment, upload | ✓ | ✓ | ✓ |
| Create / edit / move / delete **cards** | ✓ | ✓ | ✗ |
| Assign/label cards, be an assignee | ✓ | ✓ | ✗ (assignee only) |
| Edit project meta, phases, labels | ✓ | ✗ | ✗ |
| Invite / manage members, delete project | ✓ | ✗ | ✗ |

Security is enforced by **RLS**, not just the UI.

## Migration `0011_member_role.sql`

```sql
-- Allow the new role on memberships and invites.
alter table board_members drop constraint board_members_role_check;
alter table board_members add constraint board_members_role_check
  check (role in ('owner', 'member', 'client'));

alter table pending_invites add column role text not null default 'client'
  check (role in ('member', 'client'));

-- Editor = owner or member. security definer/stable like the sibling helpers.
create function is_board_editor(b uuid) returns boolean language sql security definer stable as $$
  select exists (
    select 1 from board_members
    where board_id = b and user_id = auth.uid() and role in ('owner', 'member')
  );
$$;

-- Members may write cards (and their labels); phases/labels/project stay owner-only.
drop policy cards_write on cards;
create policy cards_write on cards for all using (
  is_board_editor((select board_id from columns where id = column_id))) with check (
  is_board_editor((select board_id from columns where id = column_id)));

drop policy card_labels_write on card_labels;
create policy card_labels_write on card_labels for all using (
  is_board_editor((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id))) with check (
  is_board_editor((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));
```

`comments`/`attachments` already allow any member (incl client) to write — that
matches the spec (clients comment + upload). `columns`, `labels`, `boards`,
`board_members`, `pending_invites`, `project_finance` write policies stay
owner-only, so members can't touch structure, invites, or settings.

## Invites (`src/lib/invites.ts`)

- `inviteClient(svc, boardId, email, role)` — take a `role: 'member' | 'client'`.
  Existing user → insert `board_members` with that role. New user → store `role`
  on the `pending_invites` row; return `{ status, token }`.
- `acceptInvite` — read the invite's `role` and grant it (default `'client'`).
- Invite link (client-side): `${location.origin}/signup?invite=${token}` — signup
  already accepts `?invite`. Surface it as a copyable field when `status==='invited'`.

## UI (`board.$boardId.tsx` + components)

- Derive `const isOwner = board.role === 'owner'` and
  `const canEdit = board.role === 'owner' || board.role === 'member'`.
- Task editing gates move from `isOwner` → `canEdit`: `Column.onAddCard`,
  `Card.isDraggable`, the DnD SortableContext, `CardDetail` edit/delete, the
  `+ Add task` button.
- Owner-only stays `isOwner`: `Edit project`, project delete, the invite form.
- Invite form: a role `<select>` (Member / Client). After an invite that returns
  a token, show a read-only invite-link input + a Copy button.
- `CardDetail` and `TaskCreate` already list assignees from board members — no
  change needed; members now appear and can act.

## Testing

- Unit: extend `is_board_editor` behaviour is DB-side (covered by an RLS smoke
  check in the existing integration-test style — a member can insert a card, a
  client cannot). Add one Node/vitest test in `src/lib/*.test.ts` following the
  existing `board-data.test.ts` pattern: sign in a seeded member → insert card
  succeeds; sign in a client → insert card fails with `42501`.
- Manual: invite an email as Member → they log in, can add/move/edit tasks but
  not Edit project; invite as Client → view + comment only.

## Out of scope (YAGNI)

Global/cross-project super admin, per-user granular permissions beyond the three
roles, member-managed invites, role editing UI for existing members (re-invite
or a small role dropdown can come later if needed).
