-- Timed deadlines + opt-in reminders.
--
-- due_date stays a plain `date`: it is compared as a 'YYYY-MM-DD' string in
-- ~40 places (sorting, calendar bucketing, month prefixes). The hour lives in
-- a separate nullable column that only the detail UI and this trigger read.
--
-- reminder_offsets holds minutes-before-due. The trigger below turns them into
-- rows in `reminders`, which the existing per-minute send-reminders cron (0022)
-- emails and the notifications bell already merges. No new cron, no new mailer.

alter table cards add column if not exists due_time time;
alter table cards add column if not exists reminder_offsets int[];
alter table standalone_tasks add column if not exists due_time time;
alter table standalone_tasks add column if not exists reminder_offsets int[];

-- Where the reminder email should land. Null falls back to /home, so existing
-- rows and user-created reminders (QuickReminderForm) are unaffected.
alter table reminders add column if not exists link_path text;

do $$ begin
  alter table cards add constraint cards_reminder_offsets_check
    check (reminder_offsets is null or reminder_offsets <@ array[30, 60, 120, 1440, 2880]);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table standalone_tasks add constraint standalone_tasks_reminder_offsets_check
    check (reminder_offsets is null or reminder_offsets <@ array[30, 60, 120, 1440, 2880]);
exception when duplicate_object then null; end $$;

-- Shared by both task triggers so the wording can't drift between them.
create or replace function reminder_offset_label(mins int) returns text
language sql immutable as $$
  select case mins
    when 2880 then '2 hari'
    when 1440 then '1 hari'
    when 120  then '2 jam'
    when 60   then '1 jam'
    when 30   then '30 menit'
    else mins || ' menit'
  end;
$$;

-- Rebuilds a card's reminder rows from scratch on every relevant change.
-- security definer because the recipients are rarely auth.uid() — same reason
-- the notify_* triggers in 0020/0031 are.
create or replace function sync_card_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_card_id     uuid := coalesce(new.id, old.id);
  v_due_ts      timestamptz;
  v_col_title   text;
  v_board_id    uuid;
  v_board_title text;
  v_status      text;
  v_offs        int;
  v_uid         uuid;
begin
  -- The reset. Emailed rows go too: if the deadline moved, the reminder for the
  -- new deadline is a different event and should send again.
  delete from reminders where source_key like 'duer:card:' || v_card_id || ':%';

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.due_date is null or coalesce(array_length(new.reminder_offsets, 1), 0) = 0 then
    return new;
  end if;

  select c.title, b.id, b.title, b.status
    into v_col_title, v_board_id, v_board_title, v_status
  from columns c
  join boards b on b.id = c.board_id
  where c.id = new.column_id;

  -- Same rule as isDoneColumn() in src/lib/home.ts.
  if v_col_title is null or v_col_title ~* 'done|complete' or v_status = 'archived' then
    return new;
  end if;

  v_due_ts := (new.due_date + coalesce(new.due_time, time '17:00')) at time zone 'Asia/Jakarta';

  foreach v_offs in array new.reminder_offsets loop
    if v_due_ts - make_interval(mins => v_offs) > now() then
      for v_uid in
        select new.assignee_id where new.assignee_id is not null
        union
        select bm.user_id from board_members bm
        where bm.board_id = v_board_id and bm.role = 'owner'
      loop
        insert into reminders (user_id, message, remind_at, source_key, link_path)
        values (
          v_uid,
          'Deadline "' || new.title || '" ' || reminder_offset_label(v_offs)
            || ' lagi — ' || v_board_title,
          v_due_ts - make_interval(mins => v_offs),
          'duer:card:' || v_card_id || ':' || v_offs || ':' || v_uid,
          '/board/' || v_board_id
        )
        on conflict (source_key) do nothing;
      end loop;
    end if;
  end loop;

  return new;
end $$;

-- `title` is in the UPDATE OF list so a renamed task doesn't keep emailing its
-- old name. `column_id` is there so moving to Done cancels.
drop trigger if exists cards_sync_reminders on cards;
create trigger cards_sync_reminders
  after insert or update of due_date, due_time, reminder_offsets, assignee_id, column_id, title
  on cards
  for each row execute function sync_card_reminders();

drop trigger if exists cards_sync_reminders_delete on cards;
create trigger cards_sync_reminders_delete
  after delete on cards
  for each row execute function sync_card_reminders();
