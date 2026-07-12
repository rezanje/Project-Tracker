-- Personal KPIs and OKRs — scoped to the individual user (not a workspace),
-- shown on the personal dashboard. Mirrors 0016_kpi_okr.sql's shape; RLS is
-- simpler here since the owner is always the row's own user_id.

create table personal_kpis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  name text not null,
  target numeric not null default 0,
  current numeric not null default 0,
  unit text,
  created_at timestamptz default now()
);
alter table personal_kpis enable row level security;
create policy personal_kpi_all on personal_kpis for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table personal_objectives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  title text not null,
  created_at timestamptz default now()
);
alter table personal_objectives enable row level security;
create policy personal_obj_all on personal_objectives for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table personal_key_results (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references personal_objectives on delete cascade,
  title text not null,
  target numeric not null default 100,
  current numeric not null default 0,
  created_at timestamptz default now()
);
alter table personal_key_results enable row level security;
create policy personal_kr_all on personal_key_results for all using (
  exists (select 1 from personal_objectives o where o.id = objective_id and o.user_id = auth.uid()))
  with check (
  exists (select 1 from personal_objectives o where o.id = objective_id and o.user_id = auth.uid()));
