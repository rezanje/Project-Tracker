-- Two more edges on the reminder sync functions, found in review of 0041/0042.
--
-- The reminder_offsets CHECK only enforces containment (<@), so `{30,30}` is a
-- legal column value — nothing dedupes it before it reaches the `wanted` CTE.
-- Two rows land on the same source_key and the upsert's `on conflict … do
-- update` tries to touch that row twice in one statement, which Postgres
-- rejects outright (21000). That turns a harmless duplicate checkbox click
-- into a failed card or task save, and PostgREST is reachable directly, so
-- the client can't be trusted to filter this out first. Deduping the offsets
-- inside the CTE makes the write idempotent regardless of what arrives.
--
-- Separately, reminder_offset_label() lost its else branch in 0041 and now
-- returns NULL for any offset outside its five known values. That NULL
-- propagates into `message`, and reminders.message is NOT NULL — so an
-- unrecognised offset doesn't just show ugly text, it fails the save. Falling
-- back to a plain "<n> menit" keeps the label function free to stay a lookup
-- table without every future offset needing a matching case.

create or replace function sync_card_reminders() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_card_id     uuid := case tg_op when 'DELETE' then old.id else new.id end;
  v_due_ts      timestamptz;
  v_col_title   text;
  v_board_id    uuid;
  v_board_title text;
  v_status      text;
  v_recipients  uuid[];
begin
  -- A deleted card leaves nothing behind, fired or not.
  if tg_op = 'DELETE' then
    delete from reminders where source_key like 'duer:card:' || v_card_id || ':%';
    return old;
  end if;

  if new.due_date is not null
     and coalesce(array_length(new.reminder_offsets, 1), 0) > 0 then
    select c.title, b.id, b.title, b.status
      into v_col_title, v_board_id, v_board_title, v_status
    from columns c
    join boards b on b.id = c.board_id
    where c.id = new.column_id;

    -- Same "is it finished" rule as isDoneColumn() in src/lib/home.ts.
    if v_col_title is not null
       and v_col_title !~* 'done|complete'
       and v_status is distinct from 'archived' then
      v_due_ts := (new.due_date + coalesce(new.due_time, time '17:00')) at time zone 'Asia/Jakarta';

      select array_agg(distinct u) into v_recipients from (
        select new.assignee_id as u where new.assignee_id is not null
        union
        select bm.user_id from board_members bm
        where bm.board_id = v_board_id and bm.role = 'owner'
      ) s;
    end if;
  end if;

  -- One statement: work out what this card should have scheduled, write it,
  -- and sweep any pending row that is no longer on the list. When the guards
  -- above bailed out, `wanted` is empty and the sweep cancels everything
  -- pending — which is how clearing a deadline, unchecking every offset, and
  -- moving to Done all cancel.
  with wanted as (
    select r.u as user_id,
           'Deadline "' || new.title || '" ' || coalesce(reminder_offset_label(o.mins), o.mins || ' menit')
             || ' lagi — ' || v_board_title as message,
           v_due_ts - make_interval(mins => o.mins) as remind_at,
           'duer:card:' || v_card_id || ':' || o.mins || ':' || r.u as source_key,
           '/board/' || v_board_id as link_path
    from (select distinct mins from unnest(coalesce(new.reminder_offsets, '{}'::int[])) as t(mins)) o
    cross join unnest(coalesce(v_recipients, '{}'::uuid[])) as r(u)
    where v_due_ts - make_interval(mins => o.mins) > now()
  ),
  upserted as (
    insert into reminders (user_id, message, remind_at, source_key, link_path)
    select user_id, message, remind_at, source_key, link_path from wanted
    on conflict (source_key) do update
      set message   = excluded.message,
          link_path = excluded.link_path,
          remind_at = excluded.remind_at,
          -- Only a moved deadline is a new event worth re-sending.
          emailed_at = case when reminders.remind_at is distinct from excluded.remind_at
                            then null else reminders.emailed_at end,
          dismissed_at = case when reminders.remind_at is distinct from excluded.remind_at
                            then null else reminders.dismissed_at end
    returning 1
  )
  delete from reminders
   where source_key like 'duer:card:' || v_card_id || ':%'
     and emailed_at is null
     and source_key not in (select source_key from wanted);

  return new;
end $$;

create or replace function sync_standalone_reminders() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_task_id uuid := case tg_op when 'DELETE' then old.id else new.id end;
  v_due_ts  timestamptz;
begin
  if tg_op = 'DELETE' then
    delete from reminders where source_key like 'duer:standalone:' || v_task_id || ':%';
    return old;
  end if;

  if not new.done
     and new.due_date is not null
     and coalesce(array_length(new.reminder_offsets, 1), 0) > 0 then
    v_due_ts := (new.due_date + coalesce(new.due_time, time '17:00')) at time zone 'Asia/Jakarta';
  end if;

  -- v_due_ts stays null when the task is done, undated or has no offsets, so
  -- `wanted` comes out empty and the sweep cancels everything still pending.
  with wanted as (
    select 'Deadline "' || new.title || '" ' || coalesce(reminder_offset_label(o.mins), o.mins || ' menit') || ' lagi' as message,
           v_due_ts - make_interval(mins => o.mins) as remind_at,
           'duer:standalone:' || v_task_id || ':' || o.mins || ':' || new.user_id as source_key
    from (select distinct mins from unnest(coalesce(new.reminder_offsets, '{}'::int[])) as t(mins)) o
    where v_due_ts - make_interval(mins => o.mins) > now()
  ),
  upserted as (
    insert into reminders (user_id, message, remind_at, source_key, link_path)
    select new.user_id, message, remind_at, source_key, '/my-tasks' from wanted
    on conflict (source_key) do update
      set message   = excluded.message,
          link_path = excluded.link_path,
          remind_at = excluded.remind_at,
          emailed_at = case when reminders.remind_at is distinct from excluded.remind_at
                            then null else reminders.emailed_at end,
          dismissed_at = case when reminders.remind_at is distinct from excluded.remind_at
                            then null else reminders.dismissed_at end
    returning 1
  )
  delete from reminders
   where source_key like 'duer:standalone:' || v_task_id || ':%'
     and emailed_at is null
     and source_key not in (select source_key from wanted);

  return new;
end $$;
