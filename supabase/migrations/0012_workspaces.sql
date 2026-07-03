-- Workspace ("office") layer above projects.

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

-- Helpers. security definer + stable, like the board helpers.
create function is_workspace_member(w uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from workspace_members where workspace_id = w and user_id = auth.uid());
$$;
create function is_workspace_owner(w uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from workspace_members where workspace_id = w and user_id = auth.uid() and role = 'owner');
$$;

-- Board helpers now also honour workspace membership.
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

-- Backfill: one "My Workspace" per existing board owner; assign their boards.
with owners as (select distinct owner_id from boards where workspace_id is null),
ins as (
  insert into workspaces (owner_id, name)
  select owner_id, 'My Workspace' from owners returning id, owner_id
)
update boards b set workspace_id = ins.id from ins
  where b.owner_id = ins.owner_id and b.workspace_id is null;
