# Due-date reminders

## Problem

Tasks carry a `due_date` but nothing tells the user when one arrives. Both task
kinds are affected: `standalone_tasks.due_date` (personal, no project) and
`cards.due_date` (assigned board tasks). Today the only way to notice a due task
is to open `/my-tasks` and read the buckets.

## Approach

A daily cron scans for tasks due today and inserts rows into the **existing**
`reminders` table. Everything downstream already exists and is untouched:

- `fetchNotificationsFn` (`src/lib/notifications.ts`) already merges `reminders`
  rows with `remind_at <= now()` and `dismissed_at is null` into the header bell.
- The per-minute `send-reminder-emails` cron (migration 0022) already POSTs to
  the `send-reminders` Edge Function, which emails every un-emailed due reminder
  via Resend and stamps `emailed_at`.

So the whole feature is: *put the right rows in `reminders` each morning.*

**Why a daily scan rather than creating a reminder row when the task is created:**
a materialized reminder goes stale the moment the due date is edited or the task
is completed, and a `reminders` row has no reference back to its task, so it
cannot be re-checked at send time. Querying the tasks at send time makes both
problems disappear — the due date and done-state read at 08:00 are by definition
current — and costs no sync logic on any edit path.

Delivery channel is bell + email only. No Web Push (no service worker, no VAPID,
no subscription storage) — explicitly out of scope.

## Changes

### 1. Migration `0033_due_reminders_cron.sql`

Add an idempotency key to `reminders`, then schedule the daily scan.

```sql
-- Idempotency key for machine-generated reminders. Null for user-created ones
-- (QuickReminderForm). A plain (not partial) unique index is deliberate: Postgres
-- treats NULLs as distinct, so any number of user-created reminders coexist while
-- generated keys stay unique. A partial index (`where source_key is not null`)
-- would break the Edge Function's upsert — ON CONFLICT (source_key) cannot infer
-- a partial index without repeating its predicate, which PostgREST cannot send.
alter table reminders add column if not exists source_key text;
create unique index if not exists reminders_source_key_idx
  on reminders (source_key);

-- Daily due-date scan. 01:00 UTC = 08:00 WIB — due dates are plain calendar
-- dates, so the reminder fires on the morning of the due day, local time.
-- Same pg_net-on-a-timer pattern as 0022; that job (every minute) is what
-- actually emails the rows this one inserts.
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
```

### 2. Edge Function `supabase/functions/due-reminders/index.ts`

Follows `send-reminders`' conventions exactly: optional `CRON_SECRET` bearer
check, service-role client from env, errors logged and returned as 200 so
pg_net does not retry-storm.

Computes "today" in WIB (UTC+7) to match `localDateStr()` in `src/lib/home.ts`,
which is what the UI uses to bucket due dates everywhere.

Two queries:

- **Standalone:** `standalone_tasks` where `done = false` and `due_date = today`.
  Recipient is `user_id`.
- **Cards:** `cards` joined to `columns` and `boards`, where `due_date = today`,
  `assignee_id is not null`, the board is not archived, and the column title does
  **not** match `/done|complete/i` — the same rule `isDoneColumn()` applies
  (`src/lib/home.ts:2-4`). Recipient is `assignee_id`.

For each hit, insert into `reminders`:

| column | value |
|---|---|
| `user_id` | `user_id` (standalone) / `assignee_id` (card) |
| `message` | `Due today: "<title>"` / `Due today: "<title>" in <board title>` |
| `remind_at` | `now()` — so the existing per-minute cron picks it up immediately |
| `source_key` | `due:standalone:<id>:<YYYY-MM-DD>` / `due:card:<id>:<YYYY-MM-DD>` |

Insert with `.upsert(rows, { onConflict: 'source_key', ignoreDuplicates: true })`
so a double-fired cron is a no-op rather than a duplicate email.

## Out of scope

- **Web Push / OS-level notifications.** Bell + email only. Adding real push
  needs a service worker, VAPID keys, a `push_subscriptions` table, and a
  web-push library in the function — a separate feature.
- **Configurable timing.** Fixed at 08:00 WIB on the due day. No per-user
  preference, no day-before reminder, no snooze.
- **Overdue nagging.** Fires once, on the due day only. A task left unfinished
  gets no follow-up.
- **Digest batching.** One reminder row per task. A user with five tasks due
  gets five bell entries and five emails.
- No changes to `src/lib/notifications.ts`, the bell component, the `send-reminders`
  function, or the 0022 cron.

## Testing

The Edge Function runs on Deno; the test suite is vitest on Node, and the two
existing Edge Functions (`notify`, `send-reminders`) have no tests. This spec
does not add a Deno test toolchain.

What is tested is the part that carries the real risk — **the task-selection
rules** — as a vitest integration test against the remote DB
(`src/lib/due-reminders.test.ts`), mirroring the function's two queries via
supabase-js and asserting. Note this is a test file with no corresponding
`src/lib/due-reminders.ts` module: the queries under test live in the Deno Edge
Function, and the test re-states them against the same schema. Do **not** create
a source module for it — that would be a second copy of the query with no caller.

Assertions:

- a standalone task due today with `done = false` is selected
- a standalone task due today with `done = true` is **not** selected
- a standalone task due tomorrow is **not** selected
- a card due today in an active column with an assignee is selected
- a card due today in a column titled "Done" is **not** selected
- a card due today with `assignee_id = null` is **not** selected

The insert → email plumbing is already exercised in production by
`send-reminders` and is not re-tested here.

Also: `npx tsc --noEmit -p .` must stay clean.

## Deployment

Two manual steps, both the user's (they hold the DB password):

1. Apply `supabase/migrations/0033_due_reminders_cron.sql` via the Dashboard SQL
   Editor, then `npx supabase migration repair --status applied 0033 --db-url "<pooler-url>"`.
2. `supabase functions deploy due-reminders --no-verify-jwt`

Until both land, nothing changes for users — no reminder rows are created.
