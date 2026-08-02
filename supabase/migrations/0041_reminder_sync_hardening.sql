-- Hardening for the card reminder trigger added in 0040.
--
-- Three problems with the first cut:
--
-- 1. The reset deleted EVERY reminder for the card, including ones that had
--    already fired and were still sitting unread in the notifications bell
--    (src/lib/notifications.ts surfaces remind_at <= now() and dismissed_at is
--    null). Renaming a card or reassigning it made a live notification vanish.
--    Now only pending rows are swept; fired ones are history and stay put.
--
-- 2. `source_key like 'duer:card:<uuid>:%'` cannot use a plain btree index
--    under the default en_US.UTF-8 collation, so every card write scanned the
--    whole reminders table. A text_pattern_ops index fixes that.
--
-- 3. The recipient set was re-queried once per offset. The rewrite below is
--    set-based: one pass over offsets × recipients.
--
-- Behaviour that deliberately does NOT change: moving a deadline still
-- re-sends. The upsert clears emailed_at only when remind_at actually moved,
-- so a title edit refreshes the wording without mailing anyone twice.

create index if not exists reminders_source_key_pattern_idx
  on reminders (source_key text_pattern_ops);

-- No relations referenced, so an empty search_path is safe and satisfies the
-- function_search_path_mutable advisor.
create or replace function reminder_offset_label(mins int) returns text
language sql immutable set search_path = '' as $$
  select case mins
    when 2880 then '2 hari'
    when 1440 then '1 hari'
    when 120  then '2 jam'
    when 60   then '1 jam'
    when 30   then '30 menit'
  end;
$$;

-- pg_temp is listed last on purpose: omitting it entirely leaves it searched
-- FIRST for relation names, which lets any role with temp-create rights shadow
-- `reminders` inside this security definer function.
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
           'Deadline "' || new.title || '" ' || reminder_offset_label(o.mins)
             || ' lagi — ' || v_board_title as message,
           v_due_ts - make_interval(mins => o.mins) as remind_at,
           'duer:card:' || v_card_id || ':' || o.mins || ':' || r.u as source_key,
           '/board/' || v_board_id as link_path
    from unnest(coalesce(new.reminder_offsets, '{}'::int[])) as o(mins)
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
