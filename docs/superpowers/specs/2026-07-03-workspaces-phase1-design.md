# Workspaces — Phase 1 (foundation)

**Date:** 2026-07-03
**Goal:** Add a workspace ("office") layer above projects. A workspace has a team;
members access every project inside it. Navigation becomes Home (workspace list)
→ Workspace (its projects) → Board (tasks).

## Scope (Phase 1 only)

In: workspaces + workspace_members, `boards.workspace_id`, RLS so workspace
members reach the workspace's projects, the two-level access model, route
restructure, backfill. Out (later phases): the rich office dashboard widgets,
`urgent` priority, OKR/KPI/Leads.

## Data (migration `0012`)

```sql
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles,
  name text not null,
  created_at timestamptz default now()
);
create table workspace_members (
  workspace_id uuid references workspaces on delete cascade,
  user_id uuid references profiles on delete cascade,
  role text not null check (role in ('owner', 'member')),
  primary key (workspace_id, user_id)
);
create table pending_workspace_invites (
  token uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('member')),
  created_at timestamptz default now()
);
alter table boards add column workspace_id uuid references workspaces on delete cascade;
```

## Access model

- **Workspace owner**: full — manage workspace, its projects, invite the team.
- **Workspace member**: editor across every project in the workspace (create/edit
  tasks, be assigned).
- **Project client** (existing per-board): one project, read-only + comment/upload.

A board's effective role for a user = their `board_members.role` if present,
else their `workspace_members.role` (owner→owner, member→member), else none.

## RLS (migration `0012`)

New helpers + boards helpers extended to also honour workspace membership. All
`security definer stable`, so they may read `boards`/`workspace_members` without
RLS recursion:

```sql
create function is_workspace_member(w uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from workspace_members where workspace_id = w and user_id = auth.uid());
$$;
create function is_workspace_owner(w uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from workspace_members where workspace_id = w and user_id = auth.uid() and role = 'owner');
$$;

create or replace function is_board_member(b uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from board_members where board_id = b and user_id = auth.uid())
      or exists (select 1 from boards bo where bo.id = b and bo.workspace_id is not null and is_workspace_member(bo.workspace_id));
$$;
create or replace function is_board_owner(b uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from board_members where board_id = b and user_id = auth.uid() and role = 'owner')
      or exists (select 1 from boards bo where bo.id = b and bo.workspace_id is not null and is_workspace_owner(bo.workspace_id));
$$;
create or replace function is_board_editor(b uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from board_members where board_id = b and user_id = auth.uid() and role in ('owner', 'member'))
      or exists (select 1 from boards bo where bo.id = b and bo.workspace_id is not null and is_workspace_member(bo.workspace_id));
$$;

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table pending_workspace_invites enable row level security;
create policy workspaces_read on workspaces for select using (is_workspace_member(id));
create policy workspaces_insert on workspaces for insert with check (owner_id = auth.uid());
create policy workspaces_owner_write on workspaces for update using (is_workspace_owner(id));
create policy workspaces_owner_delete on workspaces for delete using (is_workspace_owner(id));
create policy wsm_read on workspace_members for select using (is_workspace_member(workspace_id));
create policy wsm_owner_write on workspace_members for all using (is_workspace_owner(workspace_id)) with check (is_workspace_owner(workspace_id));
create policy wsi_owner on pending_workspace_invites for all using (is_workspace_owner(workspace_id)) with check (is_workspace_owner(workspace_id));

create function add_workspace_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end $$;
create trigger on_workspace_created after insert on workspaces for each row execute function add_workspace_owner();
```

**Backfill** — one "My Workspace" per existing board owner, boards assigned to it:

```sql
with owners as (select distinct owner_id from boards where workspace_id is null),
ins as (insert into workspaces (owner_id, name) select owner_id, 'My Workspace' from owners returning id, owner_id)
update boards b set workspace_id = ins.id from ins where b.owner_id = ins.owner_id and b.workspace_id is null;
```

`workspace_id` stays nullable (helpers guard `is not null`); new boards always set it.

## Server / lib

- New `src/lib/workspaces.ts`: `listMyWorkspaces`, `createWorkspace` (client-side
  id + no `.select()` — the boards RETURNING/RLS pitfall applies), `inviteWorkspaceMember`
  (email → existing user added / pending-invite token), `acceptWorkspaceInvite`.
- `createBoard(supabase, userId, title, workspaceId)` — new project belongs to a workspace.
- `loadBoard`: compute effective role = board_members.role else workspace role.
- Signup `?invite=` already accepts board invites; extend to also accept
  `?winvite=<token>` for workspace invites (or reuse one accept endpoint that
  tries both). Keep it one accept route that checks both invite tables.

## Routes / UI

- **`/` (Home)** → **workspace list**: cards (name, project count, aggregate
  progress) + "New workspace" create. Replaces the current project dashboard here.
- **`/workspace/$workspaceId`** → the current home dashboard, scoped to that
  workspace's boards: project cards + today's tasks + focus card, "New project"
  (creates in this workspace), and an "Invite team" control (owner only) with a
  role-less Member invite + copyable link.
- **`/board/$boardId`** → unchanged, except `canEdit`/`isOwner` now derive from
  the effective role (workspace membership counts).
- The existing `fetchHome`/`Home` in `index.tsx` moves to the workspace route,
  filtered by `workspace_id`; `index.tsx` becomes the workspace-list page.

## Testing

- RLS smoke test (Node, existing integration style): a workspace member can
  read + insert a card on a project inside the workspace they never got a direct
  board invite to; a non-member cannot (`42501`).
- Manual: create workspace → create project inside → invite a member → they see
  the workspace + all its projects and can edit tasks.

## Out of scope

Workspace-level viewer role, moving a project between workspaces (can add later),
per-workspace billing, the Phase 2 dashboard widgets.
