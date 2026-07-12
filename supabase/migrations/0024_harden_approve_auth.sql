-- Harden the approve RPCs' authorization check. 0023 used `v_owner <> auth.uid()`,
-- which evaluates to NULL (treated as false by plpgsql `if`) whenever either
-- side is null — so a caller with no auth.uid() (service-role / no JWT) or a
-- KPI/objective with a null owner would slip past the guard and approve the
-- check-in. These are SECURITY DEFINER functions that bypass RLS, move
-- kpis/key_results.current, and write notifications to arbitrary users, so the
-- auth gate must fail CLOSED. `is distinct from` returns TRUE when the values
-- differ OR either is null, correctly raising 'not authorized' in every case
-- except an exact owner match. Only that one line changes in each function.

create or replace function approve_kpi_checkin(p_checkin_id uuid, p_approve boolean) returns void
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
  if v_owner is distinct from auth.uid() then raise exception 'not authorized'; end if;

  update kpi_checkins set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_checkin_id and status = 'pending'
  returning submitted_by into v_submitted_by;

  if not found then
    raise exception 'checkin no longer pending';
  end if;

  if p_approve then
    update kpis set current = v_value where id = v_kpi_id;
  end if;

  insert into notifications (user_id, message) values (
    v_submitted_by,
    case when p_approve then 'Check-in approved for "' || v_name || '"'
         else 'Check-in rejected for "' || v_name || '"' end
  );
end $$;

create or replace function approve_kr_checkin(p_checkin_id uuid, p_approve boolean) returns void
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
  if v_owner is distinct from auth.uid() then raise exception 'not authorized'; end if;

  update kr_checkins set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_checkin_id and status = 'pending'
  returning submitted_by into v_submitted_by;

  if not found then
    raise exception 'checkin no longer pending';
  end if;

  if p_approve then
    update key_results set current = v_value where id = v_kr_id;
  end if;

  insert into notifications (user_id, message) values (
    v_submitted_by,
    case when p_approve then 'Check-in approved for "' || v_title || '"'
         else 'Check-in rejected for "' || v_title || '"' end
  );
end $$;
