-- Events (Today's Timeline) and approval_requests (Need Approval) — both
-- feed previously-static Command Center panels with real, per-workspace
-- data. Reuses is_workspace_member/is_workspace_owner from 0012_workspaces.sql.

create table events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  title text not null,
  sub text,
  event_type text not null check (event_type in ('Meeting', 'Approval', 'Call', 'Review', 'Content')),
  starts_at timestamptz not null,
  attendee_ids uuid[] not null default '{}',
  created_at timestamptz default now()
);
alter table events enable row level security;
create policy events_read on events for select using (is_workspace_member(workspace_id));
create policy events_write on events for all
  using (is_workspace_owner(workspace_id)) with check (is_workspace_owner(workspace_id));

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  requested_by uuid not null references profiles,
  kind text not null check (kind in ('budget', 'leave', 'content')),
  title text not null,
  meta jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  resolved_by uuid references profiles,
  resolved_at timestamptz,
  created_at timestamptz default now()
);
alter table approval_requests enable row level security;
create policy approval_requests_read on approval_requests for select using (is_workspace_member(workspace_id));
create policy approval_requests_insert on approval_requests for insert with check (is_workspace_member(workspace_id));
create policy approval_requests_resolve on approval_requests for update
  using (is_workspace_owner(workspace_id)) with check (is_workspace_owner(workspace_id));
