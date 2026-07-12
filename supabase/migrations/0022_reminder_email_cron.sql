-- Poll for due reminders every minute and email them via the send-reminders
-- Edge Function (same pg_net pattern as 0008's notify webhook, just on a
-- timer instead of a DB event trigger since "remind_at has passed" isn't an
-- insert/update on any row).
--
-- The Edge Function is deployed at:
--   https://tzhquesopfxevsucoapb.supabase.co/functions/v1/send-reminders
-- Deployed with --no-verify-jwt, same as notify (see 0008's security note —
-- add a CRON_SECRET env var + Authorization header here to harden later).

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-reminder-emails') then
    perform cron.unschedule('send-reminder-emails');
  end if;
end $$;

select cron.schedule(
  'send-reminder-emails',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://tzhquesopfxevsucoapb.supabase.co/functions/v1/send-reminders',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
