-- Per-workspace KPIs and OKRs (objectives + key results).

create table kpis (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  name text not null,
  target numeric not null default 0,
  current numeric not null default 0,
  unit text,
  created_at timestamptz default now()
);
alter table kpis enable row level security;
create policy kpi_read on kpis for select using (is_workspace_member(workspace_id));
create policy kpi_write on kpis for all
  using (is_workspace_owner(workspace_id)) with check (is_workspace_owner(workspace_id));

create table objectives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  title text not null,
  created_at timestamptz default now()
);
alter table objectives enable row level security;
create policy obj_read on objectives for select using (is_workspace_member(workspace_id));
create policy obj_write on objectives for all
  using (is_workspace_owner(workspace_id)) with check (is_workspace_owner(workspace_id));

create table key_results (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references objectives on delete cascade,
  title text not null,
  target numeric not null default 100,
  current numeric not null default 0,
  created_at timestamptz default now()
);
alter table key_results enable row level security;
create policy kr_read on key_results for select using (
  exists (select 1 from objectives o where o.id = objective_id and is_workspace_member(o.workspace_id)));
create policy kr_write on key_results for all using (
  exists (select 1 from objectives o where o.id = objective_id and is_workspace_owner(o.workspace_id)))
  with check (
  exists (select 1 from objectives o where o.id = objective_id and is_workspace_owner(o.workspace_id)));
