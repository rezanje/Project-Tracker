-- Content calendar: a per-workspace content board (kind='content'), content
-- card fields, and a workspace-wide pillars taxonomy.
--
-- A content item is just a card in a kind='content' board — so it inherits
-- assignee, comments, attachments, membership and RLS for free, and is already
-- "connected to tasks" (it IS a task card). The calendar is a view over these
-- cards by due_date (= publish date). One content board per workspace.

-- 1. New board kind.
alter table boards drop constraint boards_kind_check;
alter table boards add constraint boards_kind_check
  check (kind in ('tasks', 'leads', 'content'));

-- 2. Workspace-wide content pillars (Education / Promo / Engagement …).
create table pillars (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  name text not null,
  color text not null default '#2563eb',
  position int not null default 0,
  created_at timestamptz default now()
);
alter table pillars enable row level security;
create policy pillars_read on pillars for select using (is_workspace_member(workspace_id));
create policy pillars_write on pillars for all
  using (is_workspace_owner(workspace_id)) with check (is_workspace_owner(workspace_id));

-- 3. Content-specific card fields (only used by content boards; null elsewhere).
alter table cards add column pillar_id uuid references pillars on delete set null;
alter table cards add column content_status text
  check (content_status in ('draft', 'scheduled', 'posted'));
alter table cards add column channels text[];  -- multi-channel: IG + TikTok + …
alter table cards add column format text;       -- reel / carousel / story / …

-- 4. Seed default column by kind. Content boards get one column ("Content");
--    status lives in the content_status field, so the kanban is vestigial here.
create or replace function add_owner_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.board_members (board_id, user_id, role) values (new.id, new.owner_id, 'owner');
  if new.kind = 'leads' then
    insert into public.columns (board_id, title, position) values
      (new.id, 'New', 0), (new.id, 'Contacted', 1), (new.id, 'Qualified', 2),
      (new.id, 'Proposal', 3), (new.id, 'Won', 4), (new.id, 'Lost', 5);
  elsif new.kind = 'content' then
    insert into public.columns (board_id, title, position) values (new.id, 'Content', 0);
  else
    insert into public.columns (board_id, title, position) values
      (new.id, 'Backlog', 0), (new.id, 'In Progress', 1), (new.id, 'Done', 2);
  end if;
  return new;
end $$;

-- 5. Every workspace gets one content board. New workspaces: via the trigger
--    (the boards insert fires add_owner_membership → seeds membership + column).
create or replace function add_workspace_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
    values (new.id, new.owner_id, 'owner');
  insert into public.boards (owner_id, title, workspace_id, kind)
    values (new.owner_id, 'Content Calendar', new.id, 'content');
  return new;
end $$;

-- 6. Backfill existing workspaces that don't have a content board yet.
insert into boards (owner_id, title, workspace_id, kind)
select w.owner_id, 'Content Calendar', w.id, 'content'
from workspaces w
where not exists (
  select 1 from boards b where b.workspace_id = w.id and b.kind = 'content'
);
