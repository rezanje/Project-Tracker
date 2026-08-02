# Deadline with time-of-day + opt-in email reminders

Date: 2026-08-02
Status: approved (design), not yet implemented

## Problem

A task's deadline is a bare calendar date. There is no time-of-day, and the only
email reminder is a blanket daily scan (`scan-due-tasks`, 08:00 WIB) that emails
*every* assignee of *every* task due that day. Users want to say "this is due
Friday 14:00" and "ping me 1 day and 1 hour before" — per task, opt-in.

## Decisions taken

| Question | Decision |
|---|---|
| Time-of-day required? | Optional. Missing time = **17:00 WIB**. |
| Who receives the email? | The assignee **plus every board owner**. Personal tasks: their owner. |
| Reminders on by default? | **No.** Nothing is scheduled unless the user picks offsets. |
| Scope | Board cards **and** standalone (personal) tasks. |
| Existing 08:00 daily scan | **Turned off.** It contradicts opt-in and would double-send. |

Offsets offered: **2 days, 1 day, 2 hours, 1 hour, 30 minutes**. Multi-select. No
custom values. Stored as minutes; one label per offset, used in both the chip and
the email subject line:

| Minutes | Label |
|---|---|
| 2880 | `2 hari` |
| 1440 | `1 hari` |
| 120 | `2 jam` |
| 60 | `1 jam` |
| 30 | `30 menit` |

## What already exists (and is reused unchanged)

- `reminders` table (`0021`): `user_id`, `message`, `remind_at`, `dismissed_at`,
  `emailed_at`, `source_key` (uniquely indexed, `0033`).
- `send-reminders` edge function + pg_cron job every minute (`0022`): emails any
  reminder whose `remind_at` has passed, honours `profiles.email_reminders`,
  stamps `emailed_at` so nothing sends twice.
- Notification bell merges due reminders (`src/lib/notifications.ts:38-44`), so
  in-app notification comes free.

**Consequence: no new cron, no new email plumbing.** The feature is "compute the
right `remind_at` rows at the right moment and insert them".

## Approach

Rejected — **migrate `due_date` from `date` to `timestamptz`**. Correct in the
abstract, but `due_date` is read at ~40 call sites, many of which compare it as a
`'YYYY-MM-DD'` string (`c.due_date < today`, `startsWith(monthPrefix)`, `?? '9999-99-99'`
sort sentinels, calendar map keys). Integration tests hit the real remote DB. The
change buys nothing the app renders today.

Chosen — **add a separate nullable `due_time time` column.** Every existing date
comparison, calendar grouping, sort and report keeps working untouched. `due_time`
is consumed by exactly two things: the detail UI and the reminder scheduler.

Rejected — **generate reminder rows in the app server functions.** There are many
write paths (`updateCardFn`, `quickCreateTaskFn`, `createStandaloneTaskFn`, drag
handlers). A database trigger catches all of them and cannot be bypassed.

Chosen — **database triggers.** One on `cards`, one on `standalone_tasks`.

## Schema (migration `0040_task_time_and_reminders.sql`)

```
cards.due_time            time            null
cards.reminder_offsets    int[]           null
standalone_tasks.due_time         time    null
standalone_tasks.reminder_offsets int[]   null
reminders.link_path       text            null
```

Constraint on both `reminder_offsets` columns: every element must be one of
`{30, 60, 120, 1440, 2880}`. Enforced with a `check` using `<@` against that array.

`reminders.link_path` is a relative path (`/board/<uuid>`, `/my-tasks`). The email
currently always links to `/home`; `send-reminders` will use `link_path` when
present. Nullable, so existing rows and `QuickReminderForm` are unaffected.

## Reminder generation

Two `security definer` trigger functions. Both follow the same shape.

**`sync_card_reminders()`** — `after insert or update of due_date, due_time,
reminder_offsets, assignee_id, column_id on cards`, plus `after delete on cards`.

1. Delete every row where `source_key like 'duer:card:<id>:%'`. This is the reset;
   everything below rebuilds from scratch. Deleting already-emailed rows is
   deliberate — if the deadline moves, the reminder for the new deadline should be
   sent again.
2. Bail out (leaving nothing scheduled) if any of these hold:
   - `due_date is null`
   - `reminder_offsets` is null or empty
   - the card's column title matches `done|complete` (same regex as
     `isDoneColumn()` in `src/lib/home.ts`)
   - the board's `status = 'archived'`
3. Compute `due_ts := (due_date + coalesce(due_time, '17:00')) at time zone 'Asia/Jakarta'`.
4. Build the recipient set: `assignee_id` (if any) ∪ every `board_members.user_id`
   with `role = 'owner'` for that card's board. Deduplicated.
5. For each offset, if `due_ts - offset > now()`, insert one `reminders` row per
   recipient:
   - `remind_at = due_ts - offset`
   - `message` = `Deadline "<title>" <label> lagi` (+ ` — <board title>`)
   - `link_path = '/board/' || board_id`
   - `source_key = 'duer:card:' || card_id || ':' || offset || ':' || user_id`
   - `on conflict (source_key) do nothing`

Offsets already in the past are silently skipped. Setting a 1-day reminder on a
task due in 2 hours schedules nothing for that offset — that is the intended
behaviour, not an error.

**`sync_standalone_reminders()`** — same, on `standalone_tasks`, with:
- recipient = `user_id` only
- skip condition = `done = true` instead of the column/archive checks
- `link_path = '/my-tasks'`
- `source_key = 'duer:standalone:<id>:<offset>:<user_id>'`

### Known limitations (accepted)

- Archiving a board does not fire the card trigger, so already-scheduled reminders
  for its cards still send. Rare; not worth a board-level trigger.
- Adding or removing a board owner does not re-run the card triggers, so the
  recipient set is frozen at the last task edit.
- Dismissing a reminder in the bell then editing the deadline resurrects it.

## Turning off the daily scan (migration `0041_disable_daily_due_scan.sql`)

`cron.unschedule('scan-due-tasks')`, guarded by an existence check so re-running is
safe. The `due-reminders` edge function stays deployed but dormant — no code or
test is deleted, so the change is one line to revert.

## UI

### Board task detail (`src/components/CardDetail.tsx`)

The deadline block at the top of the sheet becomes the single place a deadline is
edited. Today it holds a tap-to-edit date; it gains a time beside it and a reminder
row beneath it.

```
DEADLINE
Fri, Aug 14  ·  17:00          [assignee avatar]

PENGINGAT
[2 hari] [1 hari] [2 jam] [1 jam] [30 menit]
```

- Date and time are each a visible text label with a transparent native input
  (`type="date"` / `type="time"`) laid over it — the pattern already used for the
  date. Native pickers, no dependency.
- Time reads `17:00` in muted ink when unset, to show the default rather than hide it.
- The `PENGINGAT` row only renders when the task has a deadline and the viewer can
  edit. Chips are multi-select toggles.
- Every control saves immediately through `onUpdateCard` and refreshes via
  `onRefresh` — the same optimistic pattern as the existing deadline field. No
  Save button.
- **The duplicate `Deadline` date input inside the `Edit detail` disclosure is
  removed.** Two editors for one field is how they drift apart.

`TaskCreate.tsx` and `QuickTaskForm.tsx` keep their date-only field. Reminders are
set after creation, in the detail sheet.

### Personal task detail (new: `src/components/StandaloneTaskSheet.tsx`)

Standalone tasks currently have no edit surface at all — clicking one in
`/my-tasks` does nothing unless it belongs to a board (`my-tasks.tsx:273-275`).
This feature needs one. A minimal sheet, reusing the shared `Sheet` primitive:

- Title (read-only text)
- Deadline: date + time, same controls as above
- Pengingat: same chip row
- `Tandai selesai` and `Hapus`

Opened from `TaskRow`'s existing `onOpen` when `task.boardId` is null.

Backing server functions go in `src/lib/standalone-tasks.ts`:
`updateStandaloneTaskFn({ id, due_date, due_time, reminder_offsets })` and a delete.

## Data flow

```
user toggles a chip
  → onUpdateCard(cardId, { reminder_offsets })   [server fn, existing]
  → UPDATE cards                                  [Postgres]
  → sync_card_reminders() trigger                 [new]
  → DELETE + INSERT rows in reminders             [existing table]
  → pg_cron every minute → send-reminders         [existing]
  → Resend email + emailed_at stamp               [existing]
  → notification bell shows it too                [existing, free]
```

## Error handling

- Trigger functions are `security definer` and must not raise: a failure would roll
  back the user's task edit. Recipient lookups use left joins; an empty recipient
  set means zero rows inserted, not an exception.
- `send-reminders` already swallows Resend failures per-recipient and leaves
  `emailed_at` null so the next minute retries.
- The UI reverts the chip / date / time to its previous value and toasts on a
  failed save, matching the deadline field's current behaviour.

## Testing

Integration tests hit the real remote DB (per `CLAUDE.md`), so tests create and
clean up their own rows.

1. Card with deadline + `[1440, 60]` → exactly two `reminders` rows per recipient,
   at the right `remind_at`.
2. Missing `due_time` → `remind_at` computed from 17:00 WIB.
3. Offset already in the past → that offset produces no row.
4. Changing `due_date` → old rows gone, new rows at the shifted times.
5. Clearing `due_date` or `reminder_offsets` → all `duer:` rows for that task gone.
6. Moving a card to a Done column → all its `duer:` rows gone.
7. Recipient set = assignee ∪ board owners, deduplicated when the assignee *is* the
   owner.
8. Deleting a task → no orphaned reminders.
9. Standalone task equivalents of 1, 5 and 8.

Existing `src/lib/due-reminders.test.ts` stays green — that function is untouched,
only unscheduled.

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/0040_task_time_and_reminders.sql` | new — columns, constraints, both trigger functions |
| `supabase/migrations/0041_disable_daily_due_scan.sql` | new — `cron.unschedule('scan-due-tasks')` |
| `supabase/functions/send-reminders/index.ts` | use `link_path` in the email link; select the column |
| `src/lib/board-data.ts`, `src/lib/cards.ts` | add `due_time`, `reminder_offsets` to the card type and select lists |
| `src/routes/board.$boardId.tsx` | whitelist the two new fields in `updateCardFn` |
| `src/components/DeadlineFields.tsx` | new — shared date + time + reminder-chip editor, used by both sheets |
| `src/components/CardDetail.tsx` | mount DeadlineFields, remove duplicate date field |
| `src/components/StandaloneTaskSheet.tsx` | new — minimal personal-task detail sheet |
| `src/lib/standalone-tasks.ts` | `updateStandaloneTask`, `deleteStandaloneTask` data helpers |
| `src/lib/actions.ts` | `updateStandaloneTaskFn`, `deleteStandaloneTaskFn` server functions |
| `src/lib/my-tasks.ts` | `Task` gains `dueTime` and `offsets` |
| `src/routes/my-tasks.tsx` | load the new fields, open the new sheet for tasks with no board |

## Out of scope

Custom offset values, WhatsApp/SMS delivery, snooze, recurring reminders,
per-board reminder defaults, digest emails.
