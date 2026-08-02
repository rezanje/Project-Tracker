-- The 08:00 WIB blanket scan (0033) emailed every assignee of every task due
-- that day. Reminders are now opt-in per task (0040/0041), so the scan is both
-- redundant and a source of duplicate mail. Unscheduled, not deleted: the
-- due-reminders edge function and its tests stay in the repo, and re-enabling
-- is a one-line cron.schedule away.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'scan-due-tasks') then
    perform cron.unschedule('scan-due-tasks');
  end if;
end $$;
