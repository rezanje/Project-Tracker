# Signup Approval Gate + Super Admin

**Date:** 2026-07-10
**Files:** new migration `0018_signup_approval.sql`, `src/lib/auth.ts`,
`src/lib/invites.ts`, `src/lib/workspaces.ts`, `src/routes/pending.tsx` (new),
`src/routes/admin.approvals.tsx` (new).

## Goal

Two signup paths already exist, but only one is gated:

1. **Invited** — a workspace/board owner shares an invite link
   (`/signup?invite=`/`?winvite=`). Accepting it already grants a specific
   membership + role. This path is fine as-is: the owner already vetted the
   person by inviting them.
2. **Self-signup** — anyone hits `/signup` (email or "Continue with Google")
   with no invite token and lands straight on `/`, where they can create their
   own workspace and become its owner. Nothing gates this today.

Add an approval gate to path 2: self-signup accounts start **pending** and see
only a waiting page until the app's single **super admin** approves them by
assigning a workspace (+ role) or board (+ role). Invited accounts skip the
gate — they're approved automatically on invite acceptance.

Super admin is a single fixed account (`rezarezanje@gmail.com`), not a
role users can hold multiple-of.

## Data model — migration `0018_signup_approval.sql`

```sql
alter table profiles add column status text not null default 'pending'
  check (status in ('pending', 'approved'));
alter table profiles add column is_super_admin boolean not null default false;

-- Existing users keep working — nobody who already has access gets locked out.
update profiles set status = 'approved';

-- Flag the super admin by email (auth.users, not profiles, holds email).
update profiles set status = 'approved', is_super_admin = true
  where id = (select id from auth.users where email = 'rezarezanje@gmail.com');

create function is_super_admin() returns boolean language sql security definer stable as $$
  select coalesce((select is_super_admin from profiles where id = auth.uid()), false);
$$;
```

RLS additions:

```sql
-- Super admin can flip any profile's status/is_super_admin; users still
-- manage their own name/avatar via the existing self policy.
create policy profiles_admin_write on profiles for update
  using (is_super_admin()) with check (is_super_admin());

-- Approval inserts a membership row directly (no invite token involved),
-- so the existing owner-only insert policies need a super-admin escape hatch.
create policy wsm_admin_write on workspace_members for insert
  with check (is_super_admin());
create policy bm_admin_write on board_members for insert
  with check (is_super_admin());
```

## Signup flow

- `handle_new_user` trigger is unchanged — `status` defaults to `'pending'`
  for every new row.
- `acceptInvite` (`src/lib/invites.ts`) and `acceptWorkspaceInvite`
  (`src/lib/workspaces.ts`) each add one statement after inserting the
  membership: `update profiles set status = 'approved' where id = userId`.
  Both are already called with a service-role client, so no new RLS is
  needed on that write.
- Self-signup (no `invite`/`winvite` search param) stays `pending` until the
  super admin acts.

## Route guard (`src/lib/auth.ts`)

`requireUser` fetches `status, is_super_admin` alongside the session user. If
`status === 'pending'` and not `is_super_admin`, it throws
`redirect({ to: '/pending' })` instead of returning. `/pending` itself, and
the sign-out action, must not call the gated `requireUser` (or must special-
case it) to avoid a redirect loop.

This single choke point covers everything: `/`, `newWorkspace`, board routes,
etc. all already call `requireUser`, so a pending user can't create a
workspace, open a board, or otherwise get project access before approval —
closing the gap in path 2 above.

## `/pending` page

Minimal: "Your account is waiting for admin approval." + a log-out button.
No loader beyond confirming the session exists (skip the `requireUser`
redirect-loop by reading the user directly). No polling — the next
navigation/reload re-runs the guard and picks up the new status once approved.

## `/admin/approvals` page

- Guard: load the current profile; if not `is_super_admin`, redirect to `/`.
- Server fn lists profiles where `status = 'pending'` (name, email via
  `auth.admin.listUsers`, created_at).
- Per row: a small form — pick **either** a workspace (dropdown of all
  workspaces) + role (`owner`/`member`), **or** a board (dropdown) + role
  (`member`/`client`) — mirroring the roles that already exist. Submit calls a
  server fn that, using the service-role client:
  1. Inserts the `workspace_members`/`board_members` row directly (same shape
     as the existing-user branch of `inviteWorkspaceMember`/`inviteClient`).
  2. `update profiles set status = 'approved'`.
- One grant per approval keeps the form simple; the admin can reopen a
  since-approved user later (regular invite/add-member UI) for additional
  workspaces — no need to build multi-select now.

## Testing

- `src/lib/auth.test.ts` (new, following `board-data.test.ts` style):
  pending non-admin → guard redirects to `/pending`; approved user → passes
  through; `is_super_admin` user with `status='pending'` (shouldn't normally
  happen, but the super-admin row is backfilled `approved` anyway) → passes
  through.
- Extend `invites.test.ts` / add a `workspaces.test.ts` case: accepting an
  invite flips `status` to `'approved'`.
- Manual: sign up with Google (no invite link) → land on `/pending`; approve
  from `/admin/approvals` with a workspace grant → reload → lands on `/` with
  that workspace visible.

## Out of scope (YAGNI)

Multiple super admins, a `signup_requests` audit/history table, reject
(vs. approve) flow, email notifications on approval, multi-grant-per-approval
UI, self-signup + invite-token collision handling beyond what already exists.
