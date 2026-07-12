-- SMART KPI system: kpis/objectives become assignable (assignee_id/
-- assigned_by), time-bound (start_date/end_date), reviewable (kpi_checkins/
-- kr_checkins + an approve RPC), replacing the freeform personal_kpis/
-- personal_objectives/personal_key_results split (empty in production).
-- See docs/superpowers/specs/2026-07-12-smart-kpi-design.md.

alter table kpis
  add column assignee_id uuid references profiles on delete cascade,
  add column assigned_by uuid references profiles,
  add column start_date date,
  add column end_date date,
  add column status text not null default 'active'
    check (status in ('active', 'completed', 'archived'));
alter table kpis alter column workspace_id drop not null;

alter table objectives
  add column assignee_id uuid references profiles on delete cascade,
  add column assigned_by uuid references profiles,
  add column start_date date,
  add column end_date date,
  add column status text not null default 'active'
    check (status in ('active', 'completed', 'archived'));
alter table objectives alter column workspace_id drop not null;

-- Backfill guard: any pre-existing row (there should be none in production)
-- gets its workspace owner as both assignee and assigner so the not-null
-- constraints below can't fail.
update kpis set assignee_id = w.owner_id, assigned_by = w.owner_id
  from workspaces w where w.id = kpis.workspace_id and kpis.assignee_id is null;
update objectives set assignee_id = w.owner_id, assigned_by = w.owner_id
  from workspaces w where w.id = objectives.workspace_id and objectives.assignee_id is null;

alter table kpis alter column assignee_id set not null;
alter table kpis alter column assigned_by set not null;
alter table objectives alter column assignee_id set not null;
alter table objectives alter column assigned_by set not null;

-- `current` moves only through the approve RPCs below (security definer,
-- so this column-level revoke on the authenticated role doesn't apply to
-- them — see Postgres docs on SECURITY DEFINER running as the function
-- owner's privileges).
revoke update (current) on kpis from authenticated;
revoke update (current) on key_results from authenticated;

drop policy if exists kpi_read on kpis;
drop policy if exists kpi_write on kpis;
create policy kpi_read on kpis for select
  using (assignee_id = auth.uid() or assigned_by = auth.uid());
create policy kpi_insert on kpis for insert with check (
  assigned_by = auth.uid()
  and (
    (workspace_id is null and assignee_id = auth.uid())
    or (workspace_id is not null and is_workspace_owner(workspace_id)
        and exists (select 1 from workspace_members
                    where workspace_id = kpis.workspace_id and user_id = kpis.assignee_id))
  )
);
create policy kpi_owner_update on kpis for update using (assigned_by = auth.uid())
  with check (assigned_by = auth.uid());
create policy kpi_owner_delete on kpis for delete using (assigned_by = auth.uid());

drop policy if exists obj_read on objectives;
drop policy if exists obj_write on objectives;
create policy obj_read on objectives for select
  using (assignee_id = auth.uid() or assigned_by = auth.uid());
create policy obj_insert on objectives for insert with check (
  assigned_by = auth.uid()
  and (
    (workspace_id is null and assignee_id = auth.uid())
    or (workspace_id is not null and is_workspace_owner(workspace_id)
        and exists (select 1 from workspace_members
                    where workspace_id = objectives.workspace_id and user_id = objectives.assignee_id))
  )
);
create policy obj_owner_update on objectives for update using (assigned_by = auth.uid())
  with check (assigned_by = auth.uid());
create policy obj_owner_delete on objectives for delete using (assigned_by = auth.uid());

-- key_results is unchanged in shape (still resolved through its parent
-- objective), just re-pointed at the new assigned_by column.
drop policy if exists kr_write on key_results;
create policy kr_write on key_results for all using (
  exists (select 1 from objectives o where o.id = objective_id and o.assigned_by = auth.uid()))
  with check (
  exists (select 1 from objectives o where o.id = objective_id and o.assigned_by = auth.uid()));

create table kpi_checkins (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references kpis on delete cascade,
  submitted_by uuid not null references profiles,
  proposed_value numeric not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references profiles,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
-- At most one pending check-in per KPI at a time.
create unique index kpi_checkins_one_pending on kpi_checkins (kpi_id) where status = 'pending';
alter table kpi_checkins enable row level security;
create policy kpi_checkin_insert on kpi_checkins for insert with check (
  submitted_by = auth.uid()
  and exists (select 1 from kpis where id = kpi_id and assignee_id = auth.uid())
);
create policy kpi_checkin_read on kpi_checkins for select using (
  submitted_by = auth.uid()
  or exists (select 1 from kpis where id = kpi_id and assigned_by = auth.uid())
);

create table kr_checkins (
  id uuid primary key default gen_random_uuid(),
  kr_id uuid not null references key_results on delete cascade,
  submitted_by uuid not null references profiles,
  proposed_value numeric not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references profiles,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index kr_checkins_one_pending on kr_checkins (kr_id) where status = 'pending';
alter table kr_checkins enable row level security;
create policy kr_checkin_insert on kr_checkins for insert with check (
  submitted_by = auth.uid()
  and exists (
    select 1 from key_results kr join objectives o on o.id = kr.objective_id
    where kr.id = kr_id and o.assignee_id = auth.uid())
);
create policy kr_checkin_read on kr_checkins for select using (
  submitted_by = auth.uid()
  or exists (
    select 1 from key_results kr join objectives o on o.id = kr.objective_id
    where kr.id = kr_id and o.assigned_by = auth.uid())
);

-- Notify the owner when their assignee submits a check-in (reuses the
-- notifications table/bell from 0020_notifications.sql — no schema change
-- needed there, just a new source of rows).
create function notify_kpi_checkin_submitted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_name text;
begin
  select assigned_by, name into v_owner, v_name from kpis where id = new.kpi_id;
  insert into notifications (user_id, message)
  values (v_owner, 'Check-in submitted for "' || v_name || '" — needs your review');
  return new;
end $$;
create trigger on_kpi_checkin_submitted after insert on kpi_checkins
  for each row execute function notify_kpi_checkin_submitted();

create function notify_kr_checkin_submitted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_title text;
begin
  select o.assigned_by, kr.title into v_owner, v_title
    from key_results kr join objectives o on o.id = kr.objective_id where kr.id = new.kr_id;
  insert into notifications (user_id, message)
  values (v_owner, 'Check-in submitted for "' || v_title || '" — needs your review');
  return new;
end $$;
create trigger on_kr_checkin_submitted after insert on kr_checkins
  for each row execute function notify_kr_checkin_submitted();

-- Approve/reject: security definer so it can write kpis.current (locked to
-- authenticated above) and notify the submitter regardless of RLS. Raises
-- if the caller isn't the KPI's owner or the checkin is no longer pending —
-- the client-side error message just surfaces whatever this throws.
create function approve_kpi_checkin(p_checkin_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_kpi_id uuid;
  v_owner uuid;
  v_submitted_by uuid;
  v_value numeric;
  v_name text;
begin
  select kpi_id, proposed_value into v_kpi_id, v_value from kpi_checkins
    where id = p_checkin_id and status = 'pending';
  if v_kpi_id is null then raise exception 'checkin not found or not pending'; end if;

  select assigned_by, name into v_owner, v_name from kpis where id = v_kpi_id;
  if v_owner <> auth.uid() then raise exception 'not authorized'; end if;

  update kpi_checkins set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_checkin_id
  returning submitted_by into v_submitted_by;

  if p_approve then
    update kpis set current = v_value where id = v_kpi_id;
  end if;

  insert into notifications (user_id, message) values (
    v_submitted_by,
    case when p_approve then 'Check-in approved for "' || v_name || '"'
         else 'Check-in rejected for "' || v_name || '"' end
  );
end $$;

create function approve_kr_checkin(p_checkin_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_kr_id uuid;
  v_owner uuid;
  v_submitted_by uuid;
  v_value numeric;
  v_title text;
begin
  select kr_id, proposed_value into v_kr_id, v_value from kr_checkins
    where id = p_checkin_id and status = 'pending';
  if v_kr_id is null then raise exception 'checkin not found or not pending'; end if;

  select o.assigned_by, kr.title into v_owner, v_title
    from key_results kr join objectives o on o.id = kr.objective_id where kr.id = v_kr_id;
  if v_owner <> auth.uid() then raise exception 'not authorized'; end if;

  update kr_checkins set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_checkin_id
  returning submitted_by into v_submitted_by;

  if p_approve then
    update key_results set current = v_value where id = v_kr_id;
  end if;

  insert into notifications (user_id, message) values (
    v_submitted_by,
    case when p_approve then 'Check-in approved for "' || v_title || '"'
         else 'Check-in rejected for "' || v_title || '"' end
  );
end $$;

-- Empty in production — drop outright, no data migration needed.
drop table if exists personal_key_results;
drop table if exists personal_objectives;
drop table if exists personal_kpis;
