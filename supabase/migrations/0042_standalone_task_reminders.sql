-- Personal-task half of the reminder triggers. Mirrors sync_card_reminders()
-- as hardened in 0041 — read that file's header for why the sweep spares
-- already-fired rows and why the whole thing is one set-based statement.
-- Differences here: the recipient is always the task's owner, and "finished"
-- is the done flag rather than a Done column.

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
    select 'Deadline "' || new.title || '" ' || reminder_offset_label(o.mins) || ' lagi' as message,
           v_due_ts - make_interval(mins => o.mins) as remind_at,
           'duer:standalone:' || v_task_id || ':' || o.mins || ':' || new.user_id as source_key
    from unnest(coalesce(new.reminder_offsets, '{}'::int[])) as o(mins)
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

drop trigger if exists standalone_sync_reminders on standalone_tasks;
create trigger standalone_sync_reminders
  after insert or update of due_date, due_time, reminder_offsets, done, title
  on standalone_tasks
  for each row execute function sync_standalone_reminders();

drop trigger if exists standalone_sync_reminders_delete on standalone_tasks;
create trigger standalone_sync_reminders_delete
  after delete on standalone_tasks
  for each row execute function sync_standalone_reminders();
