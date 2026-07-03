-- Workspace announcements (owner posts, members read) + personal notes.

create table announcements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  author_id uuid not null references profiles,
  body text not null,
  created_at timestamptz default now()
);
alter table announcements enable row level security;
create policy ann_read on announcements for select using (is_workspace_member(workspace_id));
create policy ann_owner_write on announcements for all
  using (is_workspace_owner(workspace_id)) with check (is_workspace_owner(workspace_id));

-- Personal notes: private to their author, shown everywhere for that user.
create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  body text not null,
  created_at timestamptz default now()
);
alter table notes enable row level security;
create policy notes_own on notes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
