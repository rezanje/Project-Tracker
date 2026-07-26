-- Due-date reminders. A daily scan inserts `reminders` rows for tasks due today;
-- from there the existing machinery takes over unchanged — the bell merges due
-- reminders (fetchNotificationsFn) and the per-minute cron from 0022 emails them.

-- Idempotency key for machine-generated reminders. Null for user-created ones
-- (QuickReminderForm). A plain (not partial) unique index is deliberate: Postgres
-- treats NULLs as distinct in a unique index, so any number of user-created
-- reminders coexist, while generated keys stay unique. A partial index
-- (`where source_key is not null`) would NOT work here — ON CONFLICT (source_key)
-- cannot infer a partial index without repeating its predicate, which PostgREST's
-- upsert has no way to send.
alter table reminders add column if not exists source_key text;
create unique index if not exists reminders_source_key_idx
  on reminders (source_key);

-- 01:00 UTC = 08:00 WIB. Due dates are plain calendar dates, so the reminder
-- fires on the morning of the due day, local time. Same pg_net-on-a-timer
-- pattern as 0022; that job (every minute) is what actually emails these rows.
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'scan-due-tasks') then
    perform cron.unschedule('scan-due-tasks');
  end if;
end $$;

select cron.schedule(
  'scan-due-tasks',
  '0 1 * * *',
  $$
  select net.http_post(
    url := 'https://tzhquesopfxevsucoapb.supabase.co/functions/v1/due-reminders',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
