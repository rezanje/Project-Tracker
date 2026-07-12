-- Self-service reminders. A due reminder shows up in the notifications bell
-- next time the user has the app open (fetchNotificationsFn merges remind_at
-- <= now() rows in) AND gets emailed by the send-reminders cron (0022).
-- Idempotent throughout so a partial/re-run can't fail halfway through.

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  message text not null,
  remind_at timestamptz not null,
  dismissed_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reminders_user_idx on reminders (user_id, remind_at);
-- Used by the send-reminders cron to find due, not-yet-emailed rows.
create index if not exists reminders_due_idx on reminders (remind_at) where emailed_at is null;

alter table reminders enable row level security;
drop policy if exists reminders_all on reminders;
create policy reminders_all on reminders for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
