-- The sweep at the end of both trigger functions cancels any pending reminder
-- that isn't in `wanted` — but `wanted` only keeps offsets whose remind_at is
-- still in the future (`where v_due_ts - make_interval(mins => o.mins) >
-- now()`). The instant a reminder's time arrives it falls out of `wanted` on
-- its own, with nothing to do with whether it was actually cancelled. Until
-- the per-minute mailer stamps emailed_at, that row is indistinguishable from
-- a reminder someone genuinely removed. A card due 17:00 with a 30-minute
-- offset: at 16:35 someone drags the card to another column, the trigger
-- fires, and the 16:30 reminder — due but not yet mailed — gets swept before
-- it was ever sent. No email, no bell entry, no error. The window is up to a
-- minute on every edit, and unbounded for any recipient the mailer can't
-- reach (bad address, Resend outage), since those rows never get emailed_at
-- and stay eligible for deletion forever. Restricting the sweep to rows whose
-- remind_at is still ahead of now() means cancellation can only ever reach a
-- reminder that hasn't come due yet — exactly the case that means "the user
-- changed their mind," never "the mailer hasn't gotten to this yet."
--
-- While duplicating these functions: 0044 guarded the NULL that a dropped
-- else-branch in reminder_offset_label() could produce by wrapping every call
-- site in coalesce(...). That only protects the call sites that remember to
-- do it — the next one added won't — so the fix belongs back in the function
-- itself, restored here to its original form from 0041.

create or replace function reminder_offset_label(mins int) returns text
language sql immutable set search_path = '' as $$
  select case mins
    when 2880 then '2 hari'
    when 1440 then '1 hari'
    when 120  then '2 jam'
    when 60   then '1 jam'
    when 30   then '30 menit'
    else mins || ' menit'
  end;
$$;

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
  -- moving to Done all cancel. The sweep is further restricted to rows whose
  -- remind_at is still ahead of now(): a reminder whose time already passed
  -- is either sent (and this filter wouldn't touch it, emailed_at is not
  -- null) or waiting for the mailer, and only the mailer gets to resolve that.
  with wanted as (
    select r.u as user_id,
           'Deadline "' || new.title || '" ' || reminder_offset_label(o.mins)
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
     and remind_at > now()
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
  -- Same remind_at > now() guard as sync_card_reminders(), for the same reason.
  with wanted as (
    select 'Deadline "' || new.title || '" ' || reminder_offset_label(o.mins) || ' lagi' as message,
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
     and remind_at > now()
     and source_key not in (select source_key from wanted);

  return new;
end $$;
